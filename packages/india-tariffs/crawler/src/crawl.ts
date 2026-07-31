import { createHash } from "node:crypto";
import { DocumentArchive } from "./archive.js";
import { classifyDocument } from "./classifier.js";
import { safeFetch, RateLimiter } from "./fetcher.js";
import { recordFetchObservation } from "./db/crawlRunRepository.js";
import type { CrawlerDatabase } from "./db/client.js";
import type { AuthoritativeSource } from "./types.js";
import type { AcquisitionProvider } from "./acquisition/types.js";

export interface CrawlSourceResult {
  sourceId: string;
  linksDiscovered: number;
  documentsFetched: number;
  newDocuments: number;
  replacementsDetected: string[];
  errors: string[];
}

const ADAPTERS: Record<string, true> = {
  generic_html_link_listing: true,
};

/**
 * Runs discovery + fetch + archive for one source, persisting fetch
 * observations to the crawl_runs row identified by runId (see
 * db/crawlRunRepository.ts). This function stays entirely inside the
 * automated discovery zone (crawler architecture section 2): it never
 * writes to packages/india-tariffs/data/normalized and never marks anything
 * approved.
 *
 * The listing page is acquired via `acquisition` (HTTP, Firecrawl, or AUTO
 * per source.acquisition_mode -- see acquisition/autoProvider.ts), so a
 * JS-rendered listing page can still be discovered. Every per-document
 * download always goes through safeFetch directly, regardless of how the
 * listing was acquired: Firecrawl helps *find* links on JS-heavy pages, but
 * every byte that gets archived must still pass fetcher.ts's MIME/magic-
 * byte/streaming-size hardening, which only the HTTP path implements.
 */
export async function crawlSource(
  source: AuthoritativeSource,
  archive: DocumentArchive,
  db: CrawlerDatabase,
  runId: number,
  acquisition: AcquisitionProvider,
): Promise<CrawlSourceResult> {
  const result: CrawlSourceResult = {
    sourceId: source.source_id,
    linksDiscovered: 0,
    documentsFetched: 0,
    newDocuments: 0,
    replacementsDetected: [],
    errors: [],
  };

  if (!ADAPTERS[source.adapter]) {
    result.errors.push(`Unknown adapter "${source.adapter}" for source "${source.source_id}"`);
    return result;
  }

  const rateLimiter = new RateLimiter(source.rate_limit_requests_per_minute ?? 6);
  const permittedContentTypes = source.permitted_content_types;

  await rateLimiter.wait();
  const listing = await acquisition.acquire(source, source.url);

  // The listing page itself is never archived as a document (only the
  // documents it links to are); fetch_observations.sha256 is NOT NULL, so
  // record a hash of whatever content was actually returned (HTML or
  // rendered HTML/markdown) purely as a fingerprint for this observation
  // row, not as a document identity -- source_documents/archive.put() is
  // still the only place a sha256 acts as a real content key.
  const listingContentForHash = listing.html ?? listing.renderedHtml ?? listing.markdown ?? listing.requestedUrl;
  await recordFetchObservation(db, runId, source.source_id, {
    requestedUrl: listing.requestedUrl,
    finalUrl: listing.finalUrl,
    parentListingUrl: null,
    retrievedAt: listing.retrievedAt,
    httpStatus: listing.status === "OK" ? 200 : 0,
    contentType: listing.provider === "FIRECRAWL" ? "text/html" : null,
    contentLength: listingContentForHash.length,
    sha256: createHash("sha256").update(listingContentForHash).digest("hex"),
    fetcherVersion: `acquisition/${listing.provider.toLowerCase()}`,
    acquisitionProvider: listing.provider,
    acquisitionFallbackReason: listing.fallbackReason ?? null,
    firecrawlJobId: listing.firecrawlJobId,
  });

  if (listing.status === "ERROR") {
    result.errors.push(`Failed to fetch listing page: ${listing.error?.message ?? "unknown acquisition error"}`);
    return result;
  }

  const links = listing.discoveredLinks;
  result.linksDiscovered = links.length;

  for (const link of links) {
    await rateLimiter.wait();
    try {
      const { record, body } = await safeFetch(link.url, source, link.listingUrl, { permittedContentTypes });
      await recordFetchObservation(db, runId, source.source_id, record);

      const replacement = await archive.findReplacement(record.finalUrl, record.sha256);
      if (replacement) {
        result.replacementsDetected.push(
          `${record.finalUrl}: previously ${replacement.sha256.slice(0, 12)}, now ${record.sha256.slice(0, 12)}`,
        );
      }

      const documentType = classifyDocument(source, record.contentType);
      const { isNewDocument } = await archive.put(body, record, documentType);

      result.documentsFetched++;
      if (isNewDocument) {
        result.newDocuments++;
      }
    } catch (err) {
      result.errors.push(`Failed to fetch "${link.url}": ${(err as Error).message}`);
    }
  }

  return result;
}
