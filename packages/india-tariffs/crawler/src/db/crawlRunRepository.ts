import type { CrawlerDatabase } from "./client.js";

export interface CrawlRunHandle {
  id: number;
  sourceId: string;
}

export interface CrawlRunOutcome {
  status: "SUCCEEDED" | "FAILED" | "PARTIAL";
  linksDiscovered: number;
  documentsFetched: number;
  newDocuments: number;
  replacementsDetected: number;
  errorSummary: string | null;
}

export interface FetchObservationInput {
  requestedUrl: string;
  finalUrl: string;
  parentListingUrl: string | null;
  retrievedAt: string;
  httpStatus: number;
  contentType: string | null;
  contentLength: number | null;
  sha256: string;
  fetcherVersion: string;
  /** Which acquisition provider actually served this fetch. Defaults to "HTTP" — every document download always goes through safeFetch directly regardless of how the listing page was acquired (see acquisition/autoProvider.ts). */
  acquisitionProvider?: "HTTP" | "FIRECRAWL";
  /** Set only when AUTO mode fell back to Firecrawl for the listing-page acquisition step; null for ordinary HTTP fetches. */
  acquisitionFallbackReason?: string | null;
  firecrawlJobId?: string | null;
  mimeValidated?: boolean;
  pdfMagicBytesValid?: boolean | null;
}

/**
 * Inserts a RUNNING crawl_runs row for one source. Called once at the start
 * of a crawlSource() invocation; the caller (cli.ts today, scheduler.ts
 * later) owns the run's lifecycle so a future batch runner can start one row
 * per source in a loop without crawlSource needing to know about batching.
 */
export async function startCrawlRun(
  db: CrawlerDatabase,
  sourceId: string,
  crawlerVersion: string,
): Promise<CrawlRunHandle> {
  return db.withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO crawl_runs (source_id, status, crawler_version)
       VALUES ($1, 'RUNNING', $2)
       RETURNING id`,
      [sourceId, crawlerVersion],
    );
    return { id: Number(rows[0].id), sourceId };
  });
}

/**
 * Transitions a crawl_runs row to a terminal status with final counters.
 * Idempotent to call once per run (a second call simply overwrites the same
 * row with the same terminal values, since crawl_runs has no state machine
 * enforcement beyond the CHECK constraint on status).
 */
export async function finishCrawlRun(db: CrawlerDatabase, runId: number, outcome: CrawlRunOutcome): Promise<void> {
  await db.withClient(async (client) => {
    await client.query(
      `UPDATE crawl_runs
       SET finished_at = now(),
           status = $2,
           links_discovered = $3,
           documents_fetched = $4,
           new_documents = $5,
           replacements_detected = $6,
           error_summary = $7
       WHERE id = $1`,
      [
        runId,
        outcome.status,
        outcome.linksDiscovered,
        outcome.documentsFetched,
        outcome.newDocuments,
        outcome.replacementsDetected,
        outcome.errorSummary,
      ],
    );
  });
}

/**
 * Records one fetch attempt tied to a crawl run. fetch_observations is an
 * append-only log of retrievals that produced real bytes off the wire (see
 * crawl.ts) -- fetches that threw before materializing a response (network
 * error, disallowed domain, timeout) are not recorded here, only in the
 * crawl_runs.error_summary text. Re-observing the same sha256/URL within the
 * same or a later run is expected and intentional: this table is a history
 * of retrievals, not a deduplicated set -- deduplication of the underlying
 * document happens in source_documents (see archive.ts).
 */
export async function recordFetchObservation(
  db: CrawlerDatabase,
  runId: number,
  sourceId: string,
  observation: FetchObservationInput,
): Promise<void> {
  await db.withClient(async (client) => {
    await client.query(
      `INSERT INTO fetch_observations (
         crawl_run_id, source_id, requested_url, final_url, parent_listing_url,
         retrieved_at, http_status, content_type, content_length, sha256, fetcher_version,
         acquisition_provider, acquisition_fallback_reason, firecrawl_job_id,
         mime_validated, pdf_magic_bytes_valid
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        runId,
        sourceId,
        observation.requestedUrl,
        observation.finalUrl,
        observation.parentListingUrl,
        observation.retrievedAt,
        observation.httpStatus,
        observation.contentType,
        observation.contentLength,
        observation.sha256,
        observation.fetcherVersion,
        observation.acquisitionProvider ?? "HTTP",
        observation.acquisitionFallbackReason ?? null,
        observation.firecrawlJobId ?? null,
        observation.mimeValidated ?? false,
        observation.pdfMagicBytesValid ?? null,
      ],
    );
  });
}
