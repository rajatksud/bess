export type SourceType =
  | "TARIFF_ORDER"
  | "TARIFF_SCHEDULE"
  | "GAZETTE_NOTIFICATION"
  | "LICENSEE_CIRCULAR"
  | "BILL_CALCULATOR"
  | "SECONDARY_SUMMARY";

export type DocumentType = SourceType | "CORRIGENDUM";

export type MonitoringStatus = "ACTIVE" | "PAUSED" | "DEGRADED" | "BLOCKED" | "NOT_CONFIGURED";

export type DiscoveryMethod =
  | "HTML_LINKS"
  | "PAGINATED_LISTING"
  | "SITEMAP"
  | "RSS_ATOM"
  | "JSON_API"
  | "DIRECT_DOCUMENT"
  | "SEARCH_ENDPOINT"
  | "BROWSER_RENDERED";

/**
 * How a source's pages are acquired, distinct from how a page is
 * interpreted once acquired (the `adapter` field). HTTP uses the plain
 * safeFetch path; FIRECRAWL always uses the self-hosted Firecrawl service;
 * AUTO tries HTTP first and falls back to Firecrawl per the heuristics in
 * acquisition/autoProvider.ts (SPA-shell detection, no-meaningful-links,
 * discovery_method === BROWSER_RENDERED). Defaults to AUTO at the database
 * layer (migration 0004).
 */
export type AcquisitionMode = "HTTP" | "FIRECRAWL" | "AUTO";

export interface AuthoritativeSource {
  source_id: string;
  jurisdiction_code?: string;
  regulator_code?: string;
  licensee_code?: string;
  licensee_codes?: string[];
  url: string;
  source_type: SourceType;
  authority_rank: number;
  monitoring_status: MonitoringStatus;
  allowed_domains: string[];
  discovery_method: DiscoveryMethod;
  adapter: string;
  acquisition_mode?: AcquisitionMode;
  schedule?: "HOURLY" | "EVERY_6_HOURS" | "DAILY" | "WEEKLY";
  rate_limit_requests_per_minute?: number;
  include_patterns?: string[];
  exclude_patterns?: string[];
  permitted_content_types?: string[];
  last_verified?: string;
  source_health?: "HEALTHY" | "DEGRADED" | "BLOCKED" | "MANUAL" | "NOT_CHECKED";
  last_live_check_at?: string;
  notes?: string;
}

export interface SourceRegistryFile {
  schema_version: string;
  sources: AuthoritativeSource[];
}

/** A candidate link found during discovery, before fetch. */
export interface DiscoveredLink {
  url: string;
  linkText: string;
  listingUrl: string;
}

/** Fetch record for a single retrieval attempt (crawler architecture section 7.1). */
export interface FetchRecord {
  requestedUrl: string;
  finalUrl: string;
  sourceId: string;
  retrievedAt: string;
  httpStatus: number;
  contentType: string | null;
  contentLength: number | null;
  sha256: string;
  fetcherVersion: string;
  parentListingUrl: string | null;
}

/** Immutable SourceDocument manifest entry (strategy doc section 5.1, crawler architecture section 7.2). */
export interface SourceDocumentManifestEntry {
  document_id: string;
  source_id: string;
  url: string;
  retrieved_at: string;
  http_status: number;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string;
  storage_uri: string;
  document_type: DocumentType;
  first_seen_at: string;
  observed_urls: string[];
}

export interface Manifest {
  schema_version: string;
  generated_at: string;
  documents: SourceDocumentManifestEntry[];
}
