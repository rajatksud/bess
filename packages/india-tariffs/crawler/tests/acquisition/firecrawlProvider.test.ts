import { test } from "node:test";
import assert from "node:assert/strict";
import { FirecrawlAcquisitionProvider } from "../../src/acquisition/firecrawlProvider.js";
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

const config = { baseUrl: "http://127.0.0.1:3002", apiKey: null, timeoutMs: 5000 };

/**
 * Replaces globalThis.fetch for the duration of fn, always restoring the
 * original afterward. See tests/fetcher.test.ts for why this direct-
 * reassignment pattern is used instead of node:test's
 * t.mock.method(globalThis, "fetch") (found unreliable in this sandbox).
 */
async function withMockedFetch<T>(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  fn: (calls: { url: string; body: unknown }[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return handler(input, init);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("acquire() posts to {baseUrl}/v1/scrape with the expected body shape", async () => {
  await withMockedFetch(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          id: "job-123",
          data: { html: "<html>rendered</html>", markdown: "# rendered", links: ["https://example.gov.in/order.pdf"] },
        }),
        { status: 200 },
      ),
    async (calls) => {
      const provider = new FirecrawlAcquisitionProvider(config);
      const result = await provider.acquire(baseSource, baseSource.url);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://127.0.0.1:3002/v1/scrape");
      assert.deepEqual(calls[0].body, { url: baseSource.url, formats: ["html", "markdown", "links"], onlyMainContent: false });

      assert.equal(result.status, "OK");
      assert.equal(result.provider, "FIRECRAWL");
      assert.equal(result.firecrawlJobId, "job-123");
      assert.equal(result.renderedHtml, "<html>rendered</html>");
      assert.equal(result.markdown, "# rendered");
      assert.deepEqual(
        result.discoveredLinks.map((l) => l.url),
        ["https://example.gov.in/order.pdf"],
      );
    },
  );
});

test("acquire() returns status ERROR with retryable:true on a fetch timeout", async () => {
  await withMockedFetch(
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
    async () => {
      const provider = new FirecrawlAcquisitionProvider({ ...config, timeoutMs: 10 });
      const result = await provider.acquire(baseSource, baseSource.url);

      assert.equal(result.status, "ERROR");
      assert.equal(result.error?.retryable, true);
      assert.match(result.error?.message ?? "", /timed out/);
    },
  );
});

test("acquire() returns status ERROR with retryable:false on a malformed/non-JSON response body", async () => {
  await withMockedFetch(
    async () => new Response("not valid json{{{", { status: 200 }),
    async () => {
      const provider = new FirecrawlAcquisitionProvider(config);
      const result = await provider.acquire(baseSource, baseSource.url);

      assert.equal(result.status, "ERROR");
      assert.equal(result.error?.retryable, false);
      assert.match(result.error?.message ?? "", /not valid JSON/);
    },
  );
});

test("acquire() returns status ERROR when Firecrawl responds success:false", async () => {
  await withMockedFetch(
    async () => new Response(JSON.stringify({ success: false, error: "url could not be scraped" }), { status: 200 }),
    async () => {
      const provider = new FirecrawlAcquisitionProvider(config);
      const result = await provider.acquire(baseSource, baseSource.url);

      assert.equal(result.status, "ERROR");
      assert.match(result.error?.message ?? "", /url could not be scraped/);
    },
  );
});

test("acquire() maps Firecrawl's links array into DiscoveredLink[] with the correct listingUrl", async () => {
  await withMockedFetch(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { html: "<html></html>", links: ["/relative/order.pdf", "https://example.gov.in/absolute.pdf"] },
        }),
        { status: 200 },
      ),
    async () => {
      const provider = new FirecrawlAcquisitionProvider(config);
      const result = await provider.acquire(baseSource, baseSource.url);

      assert.deepEqual(
        result.discoveredLinks.map((l) => ({ url: l.url, listingUrl: l.listingUrl })),
        [
          { url: "https://example.gov.in/relative/order.pdf", listingUrl: baseSource.url },
          { url: "https://example.gov.in/absolute.pdf", listingUrl: baseSource.url },
        ],
      );
    },
  );
});

test("acquire() returns status ERROR when Firecrawl responds with a non-2xx status", async () => {
  await withMockedFetch(
    async () => new Response("Internal Server Error", { status: 500 }),
    async () => {
      const provider = new FirecrawlAcquisitionProvider(config);
      const result = await provider.acquire(baseSource, baseSource.url);

      assert.equal(result.status, "ERROR");
      assert.equal(result.error?.retryable, true, "a 5xx from Firecrawl itself should be treated as transient");
      assert.match(result.error?.message ?? "", /500/);
    },
  );
});
