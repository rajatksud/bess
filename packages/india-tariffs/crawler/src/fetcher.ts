import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuthoritativeSource, FetchRecord } from "./types.js";

export const FETCHER_VERSION = "india-tariffs-crawler/0.1.0";
export const USER_AGENT = "BESS-IndiaTariffsCrawler/0.1 (+https://github.com/rajatksud/bess; contact: rajat.k.sud@gmail.com)";

const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB, per crawler architecture section 8 download limits
const DEFAULT_TIMEOUT_MS = 30_000;
const PDF_MAGIC_BYTES = "%PDF-";

export class DisallowedDomainError extends Error {}
export class ResponseTooLargeError extends Error {}
export class BlockedRedirectError extends Error {}
export class MimeTypeMismatchError extends Error {}
export class PdfSignatureMismatchError extends Error {}
export class UnsuccessfulResponseError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`${url} returned unsuccessful status ${status}`);
  }
}

interface FetchOptions {
  maxRetries?: number;
  timeoutMs?: number;
  /**
   * When set, materializeResponse rejects (MimeTypeMismatchError) any
   * response whose Content-Type (stripped of a "; charset=..." suffix) is
   * not in this list. Sourced from AuthoritativeSource.permitted_content_types
   * at call sites -- this field existed on the type since the original
   * registry-expansion work but was never read anywhere until now.
   */
  permittedContentTypes?: string[];
}

export interface FetchResult {
  record: FetchRecord;
  body: Buffer;
}

/** True iff body's first 5 bytes are the PDF signature "%PDF-". */
export function isPdfMagicBytes(body: Buffer): boolean {
  return body.subarray(0, PDF_MAGIC_BYTES.length).toString("latin1") === PDF_MAGIC_BYTES;
}

/**
 * True iff url's hostname is present in allowedDomains. Exported standalone
 * (refactored out of the internal assertAllowedDomain guard below) so the
 * acquisition-provider layer can apply the identical allowlist check to
 * Firecrawl-discovered links before ever fetching them -- Firecrawl must
 * never be able to route a fetch outside a source's configured domains any
 * more than a direct HTTP redirect can.
 */
export function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
  try {
    return allowedDomains.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Fetches a URL under the safe-crawling rules in
 * docs/architecture/AUTHORITATIVE_TARIFF_CRAWLER_ARCHITECTURE.md section 5.3 and 8:
 * domain allowlisting, bounded redirects restricted to allowed domains, size caps,
 * a documented user agent, and bounded retries with backoff. No script/document
 * content is ever executed here — this module only returns raw bytes plus metadata.
 */
export async function safeFetch(
  url: string,
  source: Pick<AuthoritativeSource, "source_id" | "allowed_domains">,
  parentListingUrl: string | null,
  options: FetchOptions = {},
): Promise<FetchResult> {
  assertAllowedDomain(url, source.allowed_domains, source.source_id);

  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await attemptFetch(url, source, parentListingUrl, timeoutMs, options.permittedContentTypes);
    } catch (err) {
      lastError = err;
      if (
        err instanceof DisallowedDomainError ||
        err instanceof BlockedRedirectError ||
        err instanceof MimeTypeMismatchError ||
        err instanceof PdfSignatureMismatchError ||
        err instanceof ResponseTooLargeError
      ) {
        throw err; // never retry a policy violation, integrity failure, or oversized response (same content would just be oversized again)
      }
      if (err instanceof UnsuccessfulResponseError && err.status < 500) {
        throw err; // 4xx is never transient -- no amount of retrying fixes a 404
      }
      if (attempt < maxRetries) {
        await sleep(2 ** attempt * 500);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function attemptFetch(
  url: string,
  source: Pick<AuthoritativeSource, "source_id" | "allowed_domains">,
  parentListingUrl: string | null,
  timeoutMs: number,
  permittedContentTypes: string[] | undefined,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });

    if (response.status >= 300 && response.status < 400) {
      return await followRedirect(response, url, source, parentListingUrl, timeoutMs, 0, permittedContentTypes);
    }

    return await materializeResponse(response, url, url, source.source_id, parentListingUrl, permittedContentTypes);
  } finally {
    clearTimeout(timeout);
  }
}

async function followRedirect(
  response: Response,
  requestedUrl: string,
  source: Pick<AuthoritativeSource, "source_id" | "allowed_domains">,
  parentListingUrl: string | null,
  timeoutMs: number,
  redirectCount: number,
  permittedContentTypes: string[] | undefined,
): Promise<FetchResult> {
  if (redirectCount >= MAX_REDIRECTS) {
    throw new BlockedRedirectError(`Exceeded ${MAX_REDIRECTS} redirects fetching ${requestedUrl}`);
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new BlockedRedirectError(`Redirect from ${requestedUrl} had no Location header`);
  }
  const nextUrl = new URL(location, requestedUrl).toString();
  assertAllowedDomain(nextUrl, source.allowed_domains, source.source_id);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const next = await fetch(nextUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (next.status >= 300 && next.status < 400) {
      return await followRedirect(next, nextUrl, source, parentListingUrl, timeoutMs, redirectCount + 1, permittedContentTypes);
    }
    return await materializeResponse(next, requestedUrl, nextUrl, source.source_id, parentListingUrl, permittedContentTypes);
  } finally {
    clearTimeout(timeout);
  }
}

async function materializeResponse(
  response: Response,
  requestedUrl: string,
  finalUrl: string,
  sourceId: string,
  parentListingUrl: string | null,
  permittedContentTypes: string[] | undefined,
): Promise<FetchResult> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_DOWNLOAD_BYTES) {
    throw new ResponseTooLargeError(`${finalUrl} declared content-length ${declaredLength} exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
  }

  const body = await readBodyWithLimit(response, finalUrl);
  const sha256 = createHash("sha256").update(body).digest("hex");

  const contentType = response.headers.get("content-type");
  const bareContentType = contentType?.split(";")[0]?.trim().toLowerCase() ?? null;

  if (permittedContentTypes && permittedContentTypes.length > 0) {
    const allowed = permittedContentTypes.map((t) => t.toLowerCase());
    if (!bareContentType || !allowed.includes(bareContentType)) {
      throw new MimeTypeMismatchError(
        `${finalUrl} returned content-type "${contentType ?? "<none>"}", not one of the permitted types [${permittedContentTypes.join(", ")}]`,
      );
    }
  }

  // An HTML error/interstitial page served under a claimed application/pdf
  // content-type (or requested as PDF-only via permittedContentTypes) is
  // exactly the "HTML masquerading as PDF" failure mode this guards
  // against -- validate the actual bytes, never trust the header alone.
  const expectingPdf = bareContentType === "application/pdf" || permittedContentTypes?.every((t) => t.toLowerCase() === "application/pdf");
  if (expectingPdf && !isPdfMagicBytes(body)) {
    throw new PdfSignatureMismatchError(
      `${finalUrl} was expected to be a PDF (content-type "${contentType ?? "<none>"}") but its bytes do not start with the PDF signature`,
    );
  }

  if (response.status >= 400) {
    throw new UnsuccessfulResponseError(finalUrl, response.status);
  }

  const record: FetchRecord = {
    requestedUrl,
    finalUrl,
    sourceId,
    retrievedAt: new Date().toISOString(),
    httpStatus: response.status,
    contentType,
    contentLength: body.byteLength,
    sha256,
    fetcherVersion: FETCHER_VERSION,
    parentListingUrl,
  };

  return { record, body };
}

/**
 * Reads a response body with a true streaming size limit: aborts and throws
 * as soon as the running byte count exceeds MAX_DOWNLOAD_BYTES, rather than
 * buffering the entire response first and checking afterward (the prior
 * implementation's gap -- a server that lies about or omits content-length
 * could still force a full unbounded buffer before the post-hoc check could
 * reject it).
 */
async function readBodyWithLimit(response: Response, finalUrl: string): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new ResponseTooLargeError(`${finalUrl} body exceeded ${MAX_DOWNLOAD_BYTES} bytes while streaming`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function assertAllowedDomain(url: string, allowedDomains: string[], sourceId: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new DisallowedDomainError(`Source "${sourceId}": "${url}" is not a valid URL`);
  }
  if (!allowedDomains.includes(hostname)) {
    throw new DisallowedDomainError(
      `Source "${sourceId}": host "${hostname}" is not in allowed_domains [${allowedDomains.join(", ")}]`,
    );
  }
}

/** Simple per-source rate limiter honoring rate_limit_requests_per_minute (section 5.3). */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(requestsPerMinute: number) {
    this.minIntervalMs = 60_000 / Math.max(1, requestsPerMinute);
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}
