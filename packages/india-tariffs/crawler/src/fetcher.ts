import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuthoritativeSource, FetchRecord } from "./types.js";

export const FETCHER_VERSION = "india-tariffs-crawler/0.1.0";
export const USER_AGENT = "BESS-IndiaTariffsCrawler/0.1 (+https://github.com/rajatksud/bess; contact: rajat.k.sud@gmail.com)";

const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB, per crawler architecture section 8 download limits
const DEFAULT_TIMEOUT_MS = 30_000;

export class DisallowedDomainError extends Error {}
export class ResponseTooLargeError extends Error {}
export class BlockedRedirectError extends Error {}

interface FetchOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

export interface FetchResult {
  record: FetchRecord;
  body: Buffer;
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
      return await attemptFetch(url, source, parentListingUrl, timeoutMs);
    } catch (err) {
      lastError = err;
      if (err instanceof DisallowedDomainError || err instanceof BlockedRedirectError) {
        throw err; // never retry a policy violation
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
      return await followRedirect(response, url, source, parentListingUrl, timeoutMs, 0);
    }

    return await materializeResponse(response, url, url, source.source_id, parentListingUrl);
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
      return await followRedirect(next, nextUrl, source, parentListingUrl, timeoutMs, redirectCount + 1);
    }
    return await materializeResponse(next, requestedUrl, nextUrl, source.source_id, parentListingUrl);
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
): Promise<FetchResult> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_DOWNLOAD_BYTES) {
    throw new ResponseTooLargeError(`${finalUrl} declared content-length ${declaredLength} exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new ResponseTooLargeError(`${finalUrl} body of ${arrayBuffer.byteLength} bytes exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
  }

  const body = Buffer.from(arrayBuffer);
  const sha256 = createHash("sha256").update(body).digest("hex");

  const record: FetchRecord = {
    requestedUrl,
    finalUrl,
    sourceId,
    retrievedAt: new Date().toISOString(),
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    contentLength: body.byteLength,
    sha256,
    fetcherVersion: FETCHER_VERSION,
    parentListingUrl,
  };

  return { record, body };
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
