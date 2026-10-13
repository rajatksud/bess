import type { AuthoritativeSource, DiscoveredLink } from "../types.js";

export type AcquisitionProviderName = "HTTP" | "FIRECRAWL";

export interface AcquisitionResult {
  requestedUrl: string;
  finalUrl: string;
  /** Raw HTML as returned by an ordinary (non-rendering) fetch. */
  html: string | null;
  /** Browser-rendered HTML, non-null only when the Firecrawl provider actually served the request. */
  renderedHtml: string | null;
  /** Markdown extraction, non-null only when the Firecrawl provider actually served the request. */
  markdown: string | null;
  discoveredLinks: DiscoveredLink[];
  provider: AcquisitionProviderName;
  firecrawlJobId: string | null;
  retrievedAt: string;
  durationMs: number;
  status: "OK" | "ERROR";
  error: { message: string; retryable: boolean } | null;
  /** Set only when this result was produced by an AUTO-mode fallback from HTTP to Firecrawl; the reason the fallback was triggered. */
  fallbackReason?: string | null;
}

export interface AcquisitionProvider {
  readonly name: AcquisitionProviderName;
  acquire(source: AuthoritativeSource, url: string): Promise<AcquisitionResult>;
}
