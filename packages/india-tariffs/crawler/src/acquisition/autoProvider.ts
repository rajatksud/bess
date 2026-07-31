import { load as loadHtml } from "cheerio";
import { discoverLinks } from "../adapters/genericHtmlLinkListing.js";
import { isAllowedDomain } from "../fetcher.js";
import type { AuthoritativeSource } from "../types.js";
import type { AcquisitionProvider, AcquisitionResult } from "./types.js";

export interface AutoProviderDeps {
  http: AcquisitionProvider;
  /** null when Firecrawl is not deployed (e.g. the 90-minute deployment timebox was exhausted) -- AUTO mode then behaves as HTTP-only. */
  firecrawl: AcquisitionProvider | null;
}

const SPA_BODY_TEXT_THRESHOLD = 200;
const SPA_MOUNT_POINT_MARKERS = [/id=["']root["']/i, /id=["']app["']/i, /id=["']__next["']/i, /<script[^>]+type=["']module["']/i, /<script[^>]+src=["'][^"']*bundle/i];
const MIN_RAW_LINKS_FOR_NO_LINKS_HEURISTIC = 5;

/**
 * Decides whether an HTTP acquisition result warrants falling back to
 * Firecrawl. Every branch is deterministic and evidence-based -- no branch
 * ever fires purely because Firecrawl happens to be available.
 */
export function shouldFallbackToFirecrawl(
  source: AuthoritativeSource,
  httpResult: AcquisitionResult,
): { fallback: boolean; reason: string | null } {
  // Never retry/fall back for a domain-policy violation or a DNS-shaped
  // failure -- Firecrawl fetching from the same disallowed/nonexistent host
  // would not succeed differently, and a disallowed-domain rejection must
  // never be worked around by a different acquisition path.
  if (httpResult.status === "ERROR" && httpResult.error) {
    if (!httpResult.error.retryable) {
      return { fallback: false, reason: null };
    }
    if (/ENOTFOUND|EAI_AGAIN/.test(httpResult.error.message)) {
      return { fallback: false, reason: null };
    }
  }

  if (httpResult.status === "ERROR") {
    // A retryable, non-DNS HTTP failure (timeout, connection reset, 5xx
    // exhausted) is itself sufficient reason to try Firecrawl's rendering
    // path, which uses a different network path/browser and may succeed
    // where a plain fetch failed.
    return { fallback: true, reason: `HTTP acquisition failed: ${httpResult.error?.message ?? "unknown error"}` };
  }

  if (source.discovery_method === "BROWSER_RENDERED") {
    return { fallback: true, reason: "source configured as BROWSER_RENDERED" };
  }

  if (httpResult.html && isSpaShell(httpResult.html)) {
    return { fallback: true, reason: "HTML body text under 200 chars with SPA mount-point marker present" };
  }

  if (httpResult.html) {
    const rawLinkCount = countRawLinks(httpResult.html);
    if (httpResult.discoveredLinks.length === 0 && rawLinkCount > MIN_RAW_LINKS_FOR_NO_LINKS_HEURISTIC) {
      return {
        fallback: true,
        reason: `0 filtered links against ${rawLinkCount} raw links; likely client-rendered listing`,
      };
    }
  }

  return { fallback: false, reason: null };
}

function isSpaShell(html: string): boolean {
  const $ = loadHtml(html);
  const bodyText = $("body").text().trim();
  if (bodyText.length >= SPA_BODY_TEXT_THRESHOLD) return false;
  return SPA_MOUNT_POINT_MARKERS.some((marker) => marker.test(html));
}

function countRawLinks(html: string): number {
  const $ = loadHtml(html);
  return $("a[href]").length;
}

/**
 * Tries HTTP first (unless the source is configured BROWSER_RENDERED, in
 * which case Firecrawl is tried first, not as a fallback), falling back to
 * Firecrawl per shouldFallbackToFirecrawl. Every link Firecrawl returns is
 * re-validated against the source's own allowed_domains before being
 * returned to the caller -- Firecrawl must never be able to route a
 * downstream fetch outside a source's configured domains any more than an
 * HTTP redirect can (see fetcher.ts's per-hop allowlist re-check).
 */
export class AutoAcquisitionProvider implements AcquisitionProvider {
  // Reports the name of whichever provider actually served the request;
  // this default reflects the common case before acquire() resolves it.
  readonly name = "HTTP" as const;

  constructor(private readonly deps: AutoProviderDeps) {}

  async acquire(source: AuthoritativeSource, url: string): Promise<AcquisitionResult> {
    if (source.discovery_method === "BROWSER_RENDERED" && this.deps.firecrawl) {
      const result = await this.deps.firecrawl.acquire(source, url);
      return this.filterLinksToAllowedDomains(source, {
        ...result,
        fallbackReason: "source configured as BROWSER_RENDERED",
      });
    }

    const httpResult = await this.deps.http.acquire(source, url);

    if (!this.deps.firecrawl) {
      return httpResult;
    }

    const decision = shouldFallbackToFirecrawl(source, httpResult);
    if (!decision.fallback) {
      return httpResult;
    }

    const firecrawlResult = await this.deps.firecrawl.acquire(source, url);
    return this.filterLinksToAllowedDomains(source, { ...firecrawlResult, fallbackReason: decision.reason });
  }

  private filterLinksToAllowedDomains(source: AuthoritativeSource, result: AcquisitionResult): AcquisitionResult {
    if (result.provider !== "FIRECRAWL") return result;
    return {
      ...result,
      discoveredLinks: result.discoveredLinks.filter((link) => isAllowedDomain(link.url, source.allowed_domains)),
    };
  }
}

// discoverLinks is re-exported for callers that need to apply the same
// deterministic include/exclude filtering to Firecrawl-acquired HTML as is
// applied to plain HTTP-acquired HTML (crawl.ts does this after acquisition
// regardless of which provider served the listing page).
export { discoverLinks };
