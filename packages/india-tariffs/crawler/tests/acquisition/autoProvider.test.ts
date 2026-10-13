import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFallbackToFirecrawl, AutoAcquisitionProvider } from "../../src/acquisition/autoProvider.js";
import type { AcquisitionProvider, AcquisitionResult } from "../../src/acquisition/types.js";
import type { AuthoritativeSource } from "../../src/types.js";

const baseSource: AuthoritativeSource = {
  source_id: "EXAMPLE",
  url: "https://example.gov.in/tariffs",
  source_type: "TARIFF_ORDER",
  authority_rank: 1,
  monitoring_status: "ACTIVE",
  allowed_domains: ["example.gov.in"],
  discovery_method: "HTML_LINKS",
  adapter: "generic_html_link_listing",
};

function okResult(overrides: Partial<AcquisitionResult> = {}): AcquisitionResult {
  return {
    requestedUrl: baseSource.url,
    finalUrl: baseSource.url,
    html: "<html><body>Plenty of real content here, more than two hundred characters long so it does not look like an SPA shell at all, it is a normal server-rendered listing page with real text content for a regulator's tariff order listing.</body></html>",
    renderedHtml: null,
    markdown: null,
    discoveredLinks: [{ url: "https://example.gov.in/order.pdf", linkText: "Tariff Order", listingUrl: baseSource.url }],
    provider: "HTTP",
    firecrawlJobId: null,
    retrievedAt: new Date().toISOString(),
    durationMs: 10,
    status: "OK",
    error: null,
    ...overrides,
  };
}

function errorResult(message: string, retryable: boolean): AcquisitionResult {
  return {
    requestedUrl: baseSource.url,
    finalUrl: baseSource.url,
    html: null,
    renderedHtml: null,
    markdown: null,
    discoveredLinks: [],
    provider: "HTTP",
    firecrawlJobId: null,
    retrievedAt: new Date().toISOString(),
    durationMs: 10,
    status: "ERROR",
    error: { message, retryable },
  };
}

test("shouldFallbackToFirecrawl returns fallback:false for a non-retryable error (e.g. DisallowedDomainError)", () => {
  const decision = shouldFallbackToFirecrawl(baseSource, errorResult("host not in allowed_domains", false));
  assert.equal(decision.fallback, false);
});

test("shouldFallbackToFirecrawl returns fallback:false for a DNS ENOTFOUND-style error", () => {
  const decision = shouldFallbackToFirecrawl(baseSource, errorResult("getaddrinfo ENOTFOUND example.gov.in", true));
  assert.equal(decision.fallback, false);
});

test("shouldFallbackToFirecrawl returns fallback:true for a retryable non-DNS error", () => {
  const decision = shouldFallbackToFirecrawl(baseSource, errorResult("fetch failed: connection reset", true));
  assert.equal(decision.fallback, true);
});

test("shouldFallbackToFirecrawl returns fallback:true with reason for discovery_method BROWSER_RENDERED regardless of HTTP result", () => {
  const browserRenderedSource: AuthoritativeSource = { ...baseSource, discovery_method: "BROWSER_RENDERED" };
  const decision = shouldFallbackToFirecrawl(browserRenderedSource, okResult());
  assert.equal(decision.fallback, true);
  assert.match(decision.reason ?? "", /BROWSER_RENDERED/);
});

test("shouldFallbackToFirecrawl returns fallback:true for a near-empty body containing a React/Next mount-point marker", () => {
  const spaHtml = '<html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
  const decision = shouldFallbackToFirecrawl(baseSource, okResult({ html: spaHtml }));
  assert.equal(decision.fallback, true);
  assert.match(decision.reason ?? "", /SPA mount-point/);
});

test("shouldFallbackToFirecrawl returns fallback:false for a normal content-rich page with zero matching links and few raw links", () => {
  const sparseHtml = "<html><body>" + "Real content, no tariff-related links here at all. ".repeat(10) + '<a href="/about">About</a></body></html>';
  const decision = shouldFallbackToFirecrawl(baseSource, okResult({ html: sparseHtml, discoveredLinks: [] }));
  assert.equal(decision.fallback, false);
});

test("shouldFallbackToFirecrawl returns fallback:true for zero matching links against a large raw link count", () => {
  const manyLinksHtml =
    "<html><body>" +
    Array.from({ length: 10 }, (_, i) => `<a href="/page${i}">Page ${i}</a>`).join("") +
    " ".repeat(200) +
    "</body></html>";
  const decision = shouldFallbackToFirecrawl(baseSource, okResult({ html: manyLinksHtml, discoveredLinks: [] }));
  assert.equal(decision.fallback, true);
  assert.match(decision.reason ?? "", /raw links/);
});

class FakeProvider implements AcquisitionProvider {
  public calls = 0;
  constructor(
    public readonly name: "HTTP" | "FIRECRAWL",
    private readonly result: AcquisitionResult,
  ) {}
  async acquire(): Promise<AcquisitionResult> {
    this.calls++;
    return this.result;
  }
}

test("AutoAcquisitionProvider falls back to Firecrawl and records the fallback reason in the result", async () => {
  const http = new FakeProvider("HTTP", errorResult("fetch failed: connection reset", true));
  const firecrawlResult: AcquisitionResult = {
    ...okResult(),
    provider: "FIRECRAWL",
    discoveredLinks: [{ url: "https://example.gov.in/order.pdf", linkText: "Tariff Order", listingUrl: baseSource.url }],
  };
  const firecrawl = new FakeProvider("FIRECRAWL", firecrawlResult);

  const provider = new AutoAcquisitionProvider({ http, firecrawl });
  const result = await provider.acquire(baseSource, baseSource.url);

  assert.equal(result.provider, "FIRECRAWL");
  assert.ok(result.fallbackReason, "expected a fallback reason to be recorded");
  assert.equal(http.calls, 1);
  assert.equal(firecrawl.calls, 1);
});

test("AutoAcquisitionProvider filters Firecrawl-returned links against allowed_domains before returning them", async () => {
  const http = new FakeProvider("HTTP", errorResult("fetch failed", true));
  const firecrawlResult: AcquisitionResult = {
    ...okResult(),
    provider: "FIRECRAWL",
    discoveredLinks: [
      { url: "https://example.gov.in/order.pdf", linkText: "In-domain", listingUrl: baseSource.url },
      { url: "https://evil.example.com/malware.pdf", linkText: "Off-domain", listingUrl: baseSource.url },
    ],
  };
  const firecrawl = new FakeProvider("FIRECRAWL", firecrawlResult);

  const provider = new AutoAcquisitionProvider({ http, firecrawl });
  const result = await provider.acquire(baseSource, baseSource.url);

  assert.deepEqual(
    result.discoveredLinks.map((l) => l.url),
    ["https://example.gov.in/order.pdf"],
    "off-domain link must never be returned, even when Firecrawl itself returned it",
  );
});

test("AutoAcquisitionProvider does not call Firecrawl at all when deps.firecrawl is null and HTTP succeeds normally", async () => {
  const http = new FakeProvider("HTTP", okResult());
  const provider = new AutoAcquisitionProvider({ http, firecrawl: null });
  const result = await provider.acquire(baseSource, baseSource.url);

  assert.equal(result.provider, "HTTP");
  assert.equal(http.calls, 1);
});

test("AutoAcquisitionProvider does not call Firecrawl when HTTP succeeds and no fallback heuristic matches", async () => {
  const http = new FakeProvider("HTTP", okResult());
  const firecrawl = new FakeProvider("FIRECRAWL", { ...okResult(), provider: "FIRECRAWL" });
  const provider = new AutoAcquisitionProvider({ http, firecrawl });

  const result = await provider.acquire(baseSource, baseSource.url);

  assert.equal(result.provider, "HTTP");
  assert.equal(firecrawl.calls, 0);
});
