import { safeFetch } from "../fetcher.js";
import { discoverLinks } from "../adapters/genericHtmlLinkListing.js";
import type { AuthoritativeSource } from "../types.js";
import type { AcquisitionProvider, AcquisitionResult } from "./types.js";

/**
 * Ordinary (non-rendering) HTTP acquisition, wrapping the existing safeFetch
 * + discoverLinks path exactly as crawlSource() did before the acquisition-
 * provider abstraction was introduced. Never populates renderedHtml/
 * markdown -- those are Firecrawl-only fields.
 */
export class HttpAcquisitionProvider implements AcquisitionProvider {
  readonly name = "HTTP" as const;

  async acquire(source: AuthoritativeSource, url: string): Promise<AcquisitionResult> {
    const startedAt = Date.now();
    try {
      // Deliberately no permittedContentTypes restriction here: this is a
      // listing/navigation page acquisition, and source.permitted_content_types
      // describes the acceptable content types for the *documents this
      // source yields* (enforced separately, per-document, in crawl.ts's
      // safeFetch calls for each discovered link) -- a source configured to
      // only accept application/pdf documents must still be able to fetch
      // an ordinary HTML listing/index page to discover those PDF links.
      const { record, body } = await safeFetch(url, source, null);
      const html = record.contentType?.includes("text/html") ? body.toString("utf8") : null;
      const discoveredLinks = html ? discoverLinks(html, url, source) : [];

      return {
        requestedUrl: record.requestedUrl,
        finalUrl: record.finalUrl,
        html,
        renderedHtml: null,
        markdown: null,
        discoveredLinks,
        provider: "HTTP",
        firecrawlJobId: null,
        retrievedAt: record.retrievedAt,
        durationMs: Date.now() - startedAt,
        status: "OK",
        error: null,
      };
    } catch (err) {
      const error = err as Error;
      return {
        requestedUrl: url,
        finalUrl: url,
        html: null,
        renderedHtml: null,
        markdown: null,
        discoveredLinks: [],
        provider: "HTTP",
        firecrawlJobId: null,
        retrievedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        status: "ERROR",
        error: { message: error.message, retryable: isRetryable(error) },
      };
    }
  }
}

/**
 * Domain-policy violations (disallowed domain, blocked redirect) and
 * integrity failures (MIME mismatch, PDF signature mismatch) are never
 * retryable -- retrying would produce the identical rejection. Anything
 * else (network errors, timeouts, 5xx exhausted after safeFetch's own
 * internal retries) is treated as potentially transient.
 */
function isRetryable(error: Error): boolean {
  const nonRetryableNames = [
    "DisallowedDomainError",
    "BlockedRedirectError",
    "MimeTypeMismatchError",
    "PdfSignatureMismatchError",
    "ResponseTooLargeError",
  ];
  return !nonRetryableNames.includes(error.constructor.name);
}
