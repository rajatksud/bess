import { DocumentArchive } from "./archive.js";
import { discoverLinks } from "./adapters/genericHtmlLinkListing.js";
import { classifyDocument } from "./classifier.js";
import { safeFetch, RateLimiter } from "./fetcher.js";
import type { AuthoritativeSource } from "./types.js";

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
 * Runs discovery + fetch + archive for one source. This function stays
 * entirely inside the automated discovery zone (crawler architecture
 * section 2): it never writes to packages/india-tariffs/data/normalized
 * and never marks anything approved.
 */
export async function crawlSource(source: AuthoritativeSource, archive: DocumentArchive): Promise<CrawlSourceResult> {
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

  await rateLimiter.wait();
  let listingBody: Buffer;
  try {
    const listingFetch = await safeFetch(source.url, source, null);
    listingBody = listingFetch.body;
  } catch (err) {
    result.errors.push(`Failed to fetch listing page: ${(err as Error).message}`);
    return result;
  }

  const links = discoverLinks(listingBody.toString("utf8"), source.url, source);
  result.linksDiscovered = links.length;

  for (const link of links) {
    await rateLimiter.wait();
    try {
      const { record, body } = await safeFetch(link.url, source, link.listingUrl);

      const replacement = archive.findReplacement(record.finalUrl, record.sha256);
      if (replacement) {
        result.replacementsDetected.push(
          `${record.finalUrl}: previously ${replacement.sha256.slice(0, 12)}, now ${record.sha256.slice(0, 12)}`,
        );
      }

      const documentType = classifyDocument(source, record.contentType);
      const { isNewDocument } = archive.put(body, record, documentType);

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
