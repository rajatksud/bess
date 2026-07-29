import { test } from "node:test";
import assert from "node:assert/strict";
import { DisallowedDomainError, safeFetch } from "../src/fetcher.js";
import type { AuthoritativeSource } from "../src/types.js";

const baseSource: Pick<AuthoritativeSource, "source_id" | "allowed_domains"> = {
  source_id: "EXAMPLE",
  allowed_domains: ["example.gov.in"],
};

test("safeFetch refuses a URL whose host is not in allowed_domains", async () => {
  await assert.rejects(
    () => safeFetch("https://evil.example.com/malware.pdf", baseSource, null),
    DisallowedDomainError,
  );
});

test("safeFetch refuses a malformed URL", async () => {
  await assert.rejects(() => safeFetch("not-a-url", baseSource, null), DisallowedDomainError);
});
