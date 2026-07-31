import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTariffFields } from "../../src/extraction/fieldExtractor.js";
import type { NativeTextExtractionResult } from "../../src/extraction/pdfText.js";
import type { AuthoritativeSource } from "../../src/types.js";

const source: Pick<AuthoritativeSource, "source_id"> = { source_id: "KERC-TARIFF-ORDERS-2025" };

function page(pageNumber: number, text: string): NativeTextExtractionResult["pages"][number] {
  return { pageNumber, text, items: [] };
}

function nativeText(pages: NativeTextExtractionResult["pages"]): NativeTextExtractionResult {
  return { pages, fullText: pages.map((p) => p.text).join("\n"), method: "NATIVE_TEXT", extractorVersion: "test" };
}

// Real page-1 narrative shape from the KERC Combined ESCOMs order (see
// crawler's live extraction against the actual archived PDF), reproduced
// here so this test doesn't depend on network access or a checked-in
// multi-hundred-page PDF fixture.
const ORDER_DATE_PAGE_TEXT =
  "TARIFF ORDER FOR FY 2025-26 TO FY2027-28  27 TH   MARCH, 2025  No. 16 C-1, Miller Tank Bed Area, Bengaluru";

const CATEGORY_PAGE_TEXT =
  "(1) LT-1 Domestic: The Commission has decided for reduction in energy charges by 10-paise, 10-paise per unit for FY2025-26 and 5-paise per unit for FY2027-28 and year-on-year increase in fixed charges by Rs.25/kW, Rs.5/kW, and Rs.10/kW for FY2025-26, FY2026-27, and FY2027-28, respectively, for the category. " +
  "(2) LT-5 Industrial: The Commission has decided for no change in energy charges and no change in fixed charges for the category. " +
  "(3) HT-2(a) Industrial: The Commission has decided for reduction in energy charges by 30-paise per unit for FY2025-26 for the category.";

test("extracts order date correctly from real KERC-style page-1 whitespace ('27 TH   MARCH, 2025')", () => {
  const result = extractTariffFields(nativeText([page(1, ORDER_DATE_PAGE_TEXT), page(2, CATEGORY_PAGE_TEXT)]), [], source as AuthoritativeSource);
  assert.ok(result.length > 0);
  for (const field of result) {
    assert.equal(field.orderDate, "2025-03-27");
    assert.equal(field.unresolvedFields.includes("orderDate"), false);
  }
});

test("category-boundary slicing does not bleed text across consecutive categories", () => {
  const result = extractTariffFields(nativeText([page(1, CATEGORY_PAGE_TEXT)]), [], source as AuthoritativeSource);
  assert.equal(result.length, 3);

  const lt1 = result.find((f) => f.categoryCode === "LT-1");
  assert.ok(lt1);
  assert.equal(lt1!.categoryNameOriginal, "Domestic");
  // LT-1's decision text must not contain LT-5's or HT-2(a)'s category code.
  assert.equal(lt1!.categoryCitation!.extractedText.includes("LT-5"), false);
  assert.equal(lt1!.categoryCitation!.extractedText.includes("HT-2(a)"), false);

  const lt5 = result.find((f) => f.categoryCode === "LT-5");
  assert.ok(lt5);
  assert.equal(lt5!.categoryNameOriginal, "Industrial");
  assert.equal(lt5!.supplyLevel, "LT");

  const ht2a = result.find((f) => f.categoryCode === "HT-2(a)");
  assert.ok(ht2a);
  assert.equal(ht2a!.supplyLevel, "HT");
});

test("a real energy-charge delta is extracted with a signed decimal value and page citation", () => {
  const result = extractTariffFields(nativeText([page(235, CATEGORY_PAGE_TEXT)]), [], source as AuthoritativeSource);
  const ht2a = result.find((f) => f.categoryCode === "HT-2(a)");
  assert.ok(ht2a);
  const energyCharge = ht2a!.charges.find((c) => c.chargeType === "ENERGY");
  assert.ok(energyCharge);
  assert.equal(energyCharge!.value, "-0.30");
  assert.equal(energyCharge!.valueIsDelta, true);
  assert.equal(energyCharge!.citation.pageNumber, 235);
});

test("an explicit 'no change' category records a zero-value informational charge, not an unresolved field", () => {
  const result = extractTariffFields(nativeText([page(1, CATEGORY_PAGE_TEXT)]), [], source as AuthoritativeSource);
  const lt5 = result.find((f) => f.categoryCode === "LT-5");
  assert.ok(lt5);
  assert.equal(lt5!.unresolvedFields.includes("LT-5.energyCharge"), false);
  assert.equal(lt5!.unresolvedFields.includes("LT-5.fixedCharge"), false);
  assert.ok(lt5!.charges.some((c) => c.value === "0"));
});

test("absolute base rate is never fabricated -- always recorded as unresolved, never guessed", () => {
  const result = extractTariffFields(nativeText([page(1, CATEGORY_PAGE_TEXT)]), [], source as AuthoritativeSource);
  for (const field of result) {
    assert.ok(field.unresolvedFields.includes(`${field.categoryCode}.absoluteBaseRate`));
  }
});

test("no category-list pattern found at all returns a single unresolved sentinel result, not an empty array", () => {
  const result = extractTariffFields(nativeText([page(1, "This page contains no tariff category decisions whatsoever.")]), [], source as AuthoritativeSource);
  assert.equal(result.length, 1);
  assert.equal(result[0].categoryCode, null);
  assert.ok(result[0].unresolvedFields.includes("categoryCode"));
});
