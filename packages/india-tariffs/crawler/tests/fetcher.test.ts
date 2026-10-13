import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DisallowedDomainError,
  BlockedRedirectError,
  MimeTypeMismatchError,
  PdfSignatureMismatchError,
  ResponseTooLargeError,
  UnsuccessfulResponseError,
  safeFetch,
  isPdfMagicBytes,
  isAllowedDomain,
} from "../src/fetcher.js";
import type { AuthoritativeSource } from "../src/types.js";

const baseSource: Pick<AuthoritativeSource, "source_id" | "allowed_domains"> = {
  source_id: "EXAMPLE",
  allowed_domains: ["example.gov.in"],
};

/** Builds a minimal fetch Response for a queued mock. */
function fakeResponse(options: { status?: number; headers?: Record<string, string>; body?: Buffer | string }): Response {
  const body = options.body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body);
  const headers = new Headers(options.headers ?? {});
  return new Response(new Uint8Array(body), { status: options.status ?? 200, headers });
}

/**
 * Replaces globalThis.fetch with a queue-driven stub for the duration of fn,
 * always restoring the original afterward (even on throw). Direct
 * reassignment rather than node:test's t.mock.method(globalThis, "fetch"):
 * the latter was found unreliable in this sandbox (queued responses were
 * intermittently bypassed in favor of a real network call), so this file
 * uses the more portable explicit-substitution pattern instead.
 */
async function withMockedFetch<T>(
  responses: (Response | (() => Response))[],
  fn: (calls: { url: string }[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const queue = [...responses];
  const calls: { url: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    const next = queue.shift();
    if (!next) throw new Error("withMockedFetch: no more queued responses");
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("safeFetch refuses a URL whose host is not in allowed_domains", async () => {
  await assert.rejects(
    () => safeFetch("https://evil.example.com/malware.pdf", baseSource, null),
    DisallowedDomainError,
  );
});

test("safeFetch refuses a malformed URL", async () => {
  await assert.rejects(() => safeFetch("not-a-url", baseSource, null), DisallowedDomainError);
});

test("isPdfMagicBytes returns true for a buffer starting with %PDF-", () => {
  assert.equal(isPdfMagicBytes(Buffer.from("%PDF-1.7\n...rest of a real pdf...")), true);
});

test("isPdfMagicBytes returns false for an HTML error page claiming to be application/pdf", () => {
  assert.equal(isPdfMagicBytes(Buffer.from("<!DOCTYPE html><html><body>404 Not Found</body></html>")), false);
});

test("isAllowedDomain returns true only for hosts present in the list", () => {
  assert.equal(isAllowedDomain("https://example.gov.in/x", ["example.gov.in"]), true);
  assert.equal(isAllowedDomain("https://evil.example.com/x", ["example.gov.in"]), false);
  assert.equal(isAllowedDomain("not-a-url", ["example.gov.in"]), false);
});

test("safeFetch follows a single redirect and returns the final URL", async () => {
  await withMockedFetch(
    [
      fakeResponse({ status: 302, headers: { location: "https://example.gov.in/final.pdf" } }),
      fakeResponse({ status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF-1.4 content" }),
    ],
    async () => {
      const result = await safeFetch("https://example.gov.in/start.pdf", baseSource, null);
      assert.equal(result.record.finalUrl, "https://example.gov.in/final.pdf");
      assert.equal(result.record.requestedUrl, "https://example.gov.in/start.pdf");
    },
  );
});

test("safeFetch rejects a redirect chain exceeding MAX_REDIRECTS", async () => {
  const loopResponse = () => fakeResponse({ status: 302, headers: { location: "https://example.gov.in/loop.pdf" } });
  await withMockedFetch(Array.from({ length: 10 }, () => loopResponse), async () => {
    await assert.rejects(() => safeFetch("https://example.gov.in/start.pdf", baseSource, null), BlockedRedirectError);
  });
});

test("safeFetch re-validates allowed_domains on every redirect hop and rejects an off-domain redirect target", async () => {
  await withMockedFetch(
    [fakeResponse({ status: 302, headers: { location: "https://evil.example.com/steal.pdf" } })],
    async () => {
      await assert.rejects(() => safeFetch("https://example.gov.in/start.pdf", baseSource, null), DisallowedDomainError);
    },
  );
});

test("safeFetch retries on 5xx and eventually succeeds", async () => {
  await withMockedFetch(
    [
      fakeResponse({ status: 503 }),
      fakeResponse({ status: 200, headers: { "content-type": "text/html" }, body: "<html>ok</html>" }),
    ],
    async () => {
      const result = await safeFetch("https://example.gov.in/page", baseSource, null, { maxRetries: 2 });
      assert.equal(result.record.httpStatus, 200);
    },
  );
});

test("safeFetch does not retry on 404, throws UnsuccessfulResponseError immediately", async () => {
  await withMockedFetch([fakeResponse({ status: 404 })], async (calls) => {
    await assert.rejects(
      () => safeFetch("https://example.gov.in/missing.pdf", baseSource, null, { maxRetries: 3 }),
      UnsuccessfulResponseError,
    );
    assert.equal(calls.length, 1, "a 4xx must never be retried");
  });
});

test("safeFetch rejects a response whose declared content-length exceeds MAX_DOWNLOAD_BYTES without buffering the body", async () => {
  const oversizedDeclaredLength = 60 * 1024 * 1024; // over the 50MB cap
  await withMockedFetch(
    [
      fakeResponse({
        status: 200,
        headers: { "content-length": String(oversizedDeclaredLength), "content-type": "application/pdf" },
        body: Buffer.alloc(0), // body itself is empty; the declared header alone must trigger rejection
      }),
    ],
    async () => {
      await assert.rejects(() => safeFetch("https://example.gov.in/huge.pdf", baseSource, null), ResponseTooLargeError);
    },
  );
});

test("safeFetch enforces permittedContentTypes and rejects an unexpected content-type", async () => {
  await withMockedFetch(
    [fakeResponse({ status: 200, headers: { "content-type": "text/plain" }, body: "unexpected plain text" })],
    async () => {
      await assert.rejects(
        () => safeFetch("https://example.gov.in/should-be-pdf.pdf", baseSource, null, { permittedContentTypes: ["application/pdf"] }),
        MimeTypeMismatchError,
      );
    },
  );
});

test("safeFetch throws PdfSignatureMismatchError when content-type is application/pdf but bytes are not %PDF-", async () => {
  await withMockedFetch(
    [
      fakeResponse({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: "<!DOCTYPE html><html><body>Server Error</body></html>",
      }),
    ],
    async () => {
      await assert.rejects(() => safeFetch("https://example.gov.in/fake.pdf", baseSource, null), PdfSignatureMismatchError);
    },
  );
});
