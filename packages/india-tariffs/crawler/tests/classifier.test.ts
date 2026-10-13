import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDocument, detectEffectiveDateLanguage, detectFinalOrderSignatureLanguage } from "../src/classifier.js";
import type { ClassificationEvidence } from "../src/classifier.js";

function evidence(overrides: Partial<ClassificationEvidence>): ClassificationEvidence {
  return {
    linkText: null,
    url: "https://example.gov.in/doc.pdf",
    documentTitle: null,
    firstPageText: null,
    issuingAuthority: null,
    orderNumber: null,
    hasEffectiveDateLanguage: false,
    hasFinalOrderSignatureLanguage: false,
    ...overrides,
  };
}

// Highest-priority test in this file: a petition must never be classified
// into a tariff-bearing class, even when it also contains final-order-shaped
// language (a real petition can quote or propose such language) -- this is
// the guarantee that keeps petitions out of extraction entirely (see
// extraction/extractionOrchestrator.ts's TARIFF_BEARING_CLASSES check, which
// depends on this classifier never mislabeling a petition).
test("a document mentioning 'petition' is always classified TARIFF_PETITION, even with final-order-shaped language present", () => {
  const outcome = classifyDocument(
    evidence({
      documentTitle: "Petition for approval of tariff",
      firstPageText:
        "This petition prays that the Commission may hereby order and approve the tariff, effective from 1 April 2026, as proposed herein.",
      hasEffectiveDateLanguage: true,
      hasFinalOrderSignatureLanguage: true,
    }),
  );
  assert.equal(outcome.documentClass, "TARIFF_PETITION");
});

test("public notice / notice inviting objections is classified PUBLIC_NOTICE, not a tariff-bearing class", () => {
  const outcome = classifyDocument(
    evidence({ firstPageText: "Public Notice: the Commission invites objections and comments on the proposed tariff." }),
  );
  assert.equal(outcome.documentClass, "PUBLIC_NOTICE");
});

test("a hearing notice without final-order language is classified PUBLIC_NOTICE", () => {
  const outcome = classifyDocument(evidence({ firstPageText: "Notice of hearing scheduled for 12 May 2026 on the proposed tariff revision." }));
  assert.equal(outcome.documentClass, "PUBLIC_NOTICE");
});

test("corrigendum keyword short-circuits to CORRIGENDUM", () => {
  const outcome = classifyDocument(evidence({ documentTitle: "Corrigendum to Tariff Order No. 5" }));
  assert.equal(outcome.documentClass, "CORRIGENDUM");
});

test("FAC/FPPAS adjustment language classifies as FAC_FPPAS_ADJUSTMENT", () => {
  const outcome = classifyDocument(evidence({ firstPageText: "Fuel and Power Purchase Cost Adjustment for Q1 FY2026-27" }));
  assert.equal(outcome.documentClass, "FAC_FPPAS_ADJUSTMENT");
});

test("MYT order language classifies as MYT_ORDER", () => {
  const outcome = classifyDocument(evidence({ documentTitle: "Multi Year Tariff Order FY2025-30" }));
  assert.equal(outcome.documentClass, "MYT_ORDER");
});

test("true-up with rate-revision language classifies as TRUE_UP_WITH_RATE_CHANGE", () => {
  const outcome = classifyDocument(
    evidence({ firstPageText: "True-up for FY2024-25 along with revision in tariff schedule attached herewith." }),
  );
  assert.equal(outcome.documentClass, "TRUE_UP_WITH_RATE_CHANGE");
});

test("true-up without rate-revision language classifies as TRUE_UP_NO_RATE_CHANGE", () => {
  const outcome = classifyDocument(evidence({ firstPageText: "True-up for FY2024-25 with no change to the approved tariff." }));
  assert.equal(outcome.documentClass, "TRUE_UP_NO_RATE_CHANGE");
});

test("final order requires BOTH signature and effective-date language -- signature alone is not enough", () => {
  const outcome = classifyDocument(
    evidence({ firstPageText: "The Commission hereby orders as follows, in exercise of powers under the Act." }),
  );
  assert.notEqual(outcome.documentClass, "FINAL_TARIFF_ORDER");
});

test("final order requires BOTH signature and effective-date language -- effective-date alone is not enough", () => {
  const outcome = classifyDocument(evidence({ firstPageText: "This schedule shall come into effect from 1 April 2026." }));
  assert.notEqual(outcome.documentClass, "FINAL_TARIFF_ORDER");
});

test("final order classifies correctly when both signature and effective-date language are present", () => {
  const outcome = classifyDocument(
    evidence({
      firstPageText: "The Commission hereby orders and determines the tariff, effective from 1 April 2026.",
      hasEffectiveDateLanguage: true,
      hasFinalOrderSignatureLanguage: true,
    }),
  );
  assert.equal(outcome.documentClass, "FINAL_TARIFF_ORDER");
});

test("tariff-schedule-shaped language without signature/effective-date falls to TARIFF_SCHEDULE at lower confidence", () => {
  const outcome = classifyDocument(evidence({ documentTitle: "Retail Supply Tariff Order 2025-26 - Schedule of Charges" }));
  assert.equal(outcome.documentClass, "TARIFF_SCHEDULE");
  assert.ok(outcome.confidence < 0.8);
});

test("unmatched content falls back to IRRELEVANT rather than defaulting optimistically", () => {
  const outcome = classifyDocument(evidence({ firstPageText: "Annual report on consumer grievance redressal statistics." }));
  assert.equal(outcome.documentClass, "IRRELEVANT");
  assert.ok(outcome.confidence < 0.5);
});

test("detectEffectiveDateLanguage recognizes w.e.f. abbreviation", () => {
  assert.equal(detectEffectiveDateLanguage("The revised rates apply w.e.f. 1st April 2026."), true);
});

test("detectFinalOrderSignatureLanguage recognizes 'ordered accordingly'", () => {
  assert.equal(detectFinalOrderSignatureLanguage("The Commission has decided; ordered accordingly."), true);
});
