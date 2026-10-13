import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractNativeText, ExtractionUnresolvedError, sanitizeExtractedText } from "../../src/extraction/pdfText.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

test("extractNativeText returns real per-page positioned text for a valid PDF", async () => {
  const buffer = readFileSync(join(FIXTURES_DIR, "minimal-valid.pdf"));
  const result = await extractNativeText(buffer);

  assert.equal(result.pages.length, 1);
  assert.equal(result.method, "NATIVE_TEXT");
  assert.match(result.pages[0].text, /KARNATAKA ELECTRICITY REGULATORY COMMISSION/);
  assert.ok(result.pages[0].items.length > 0);
  for (const item of result.pages[0].items) {
    assert.equal(typeof item.x, "number");
    assert.equal(typeof item.y, "number");
  }
});

test("extractNativeText throws ExtractionUnresolvedError for a corrupt/truncated PDF", async () => {
  const buffer = readFileSync(join(FIXTURES_DIR, "truncated.pdf"));
  await assert.rejects(() => extractNativeText(buffer), ExtractionUnresolvedError);
});

test("extractNativeText throws ExtractionUnresolvedError for a scanned/image-only PDF with no text layer", async () => {
  const buffer = readFileSync(join(FIXTURES_DIR, "scanned-no-text.pdf"));
  await assert.rejects(() => extractNativeText(buffer), ExtractionUnresolvedError);
});

test("sanitizeExtractedText strips embedded NUL characters without altering other content", () => {
  const withNul = `page 233${String.fromCharCode(0)} energy charge -0.30 INR/kWh`;
  const sanitized = sanitizeExtractedText(withNul);
  assert.equal(sanitized.includes(String.fromCharCode(0)), false);
  assert.equal(sanitized, "page 233 energy charge -0.30 INR/kWh");
});
