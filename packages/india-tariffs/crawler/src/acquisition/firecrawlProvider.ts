import type { AuthoritativeSource, DiscoveredLink } from "../types.js";
import type { AcquisitionProvider, AcquisitionResult } from "./types.js";

export interface FirecrawlConfig {
  /** e.g. http://127.0.0.1:3002 (self-hosted, host-local) or a private-network hostname. */
  baseUrl: string;
  /** Self-hosted Firecrawl commonly runs with no auth; leave null in that case. */
  apiKey: string | null;
  timeoutMs: number;
}

interface FirecrawlScrapeResponseData {
  html?: string;
  markdown?: string;
  links?: string[];
  metadata?: { statusCode?: number; sourceURL?: string };
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: FirecrawlScrapeResponseData;
  error?: string;
  id?: string;
}

/**
 * Acquires a page via a self-hosted Firecrawl instance's /v1/scrape
 * endpoint. Never throws for an ordinary "the site returned something odd"
 * outcome -- non-2xx responses, malformed JSON, or a request timeout are
 * all returned as status: "ERROR" with a structured error, so the caller
 * (AutoAcquisitionProvider) decides retry/fallback policy rather than this
 * provider making that decision unilaterally.
 */
export class FirecrawlAcquisitionProvider implements AcquisitionProvider {
  readonly name = "FIRECRAWL" as const;

  constructor(private readonly config: FirecrawlConfig) {}

  async acquire(source: AuthoritativeSource, url: string): Promise<AcquisitionResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(`${this.config.baseUrl}/v1/scrape`, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          url,
          formats: ["html", "markdown", "links"],
          onlyMainContent: false,
        }),
      });

      if (!response.ok) {
        return errorResult(url, startedAt, `Firecrawl returned HTTP ${response.status}`, response.status >= 500);
      }

      let parsed: FirecrawlScrapeResponse;
      try {
        parsed = (await response.json()) as FirecrawlScrapeResponse;
      } catch {
        return errorResult(url, startedAt, "Firecrawl response body was not valid JSON", false);
      }

      if (!parsed.success || !parsed.data) {
        return errorResult(url, startedAt, parsed.error ?? "Firecrawl reported success:false with no data", false);
      }

      const rawLinks = parsed.data.links ?? [];
      const discoveredLinks: DiscoveredLink[] = rawLinks
        .map((linkUrl) => toDiscoveredLink(linkUrl, url))
        .filter((l): l is DiscoveredLink => l !== null);

      return {
        requestedUrl: url,
        finalUrl: parsed.data.metadata?.sourceURL ?? url,
        html: parsed.data.html ?? null,
        renderedHtml: parsed.data.html ?? null,
        markdown: parsed.data.markdown ?? null,
        discoveredLinks,
        provider: "FIRECRAWL",
        firecrawlJobId: parsed.id ?? null,
        retrievedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        status: "OK",
        error: null,
      };
    } catch (err) {
      const error = err as Error;
      const timedOut = error.name === "AbortError";
      return errorResult(url, startedAt, timedOut ? "Firecrawl request timed out" : error.message, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function errorResult(url: string, startedAt: number, message: string, retryable: boolean): AcquisitionResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    html: null,
    renderedHtml: null,
    markdown: null,
    discoveredLinks: [],
    provider: "FIRECRAWL",
    firecrawlJobId: null,
    retrievedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status: "ERROR",
    error: { message, retryable },
  };
}

function toDiscoveredLink(linkUrl: string, listingUrl: string): DiscoveredLink | null {
  try {
    const absolute = new URL(linkUrl, listingUrl).toString();
    return { url: absolute, linkText: "", listingUrl };
  } catch {
    return null;
  }
}
