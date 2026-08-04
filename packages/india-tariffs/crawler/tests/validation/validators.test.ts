import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSchema,
  validateReferential,
  validateEffectiveDate,
  validateUnits,
  validateProvenance,
  validateCommercialSanity,
  validateCategoryResolution,
} from "../../src/validation/validators.js";
import type { CandidateTariffRecord, ChargeComponentRecord, DocumentSourceRecord } from "../../src/validation/validators.js";

function candidate(overrides: Partial<CandidateTariffRecord> = {}): CandidateTariffRecord {
  return {
    id: 1,
    documentId: "DOC-1",
    jurisdictionCode: "KA",
    licenseeCode: "BESCOM",
    categoryCode: "LT-1",
    orderDate: "2025-03-27",
    effectiveFrom: "2025-04-01",
    rawFields: {},
    ...overrides,
  };
}

function charge(overrides: Partial<ChargeComponentRecord> = {}): ChargeComponentRecord {
  return {
    id: 1,
    candidateTariffId: 1,
    chargeType: "ENERGY",
    value: "-0.30",
    unit: "INR_PER_KWH",
    citationCount: 1,
    ...overrides,
  };
}

test("validateSchema flags a candidate with no category_code as ERROR", () => {
  const findings = validateSchema(candidate({ categoryCode: null }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "ERROR");
});

test("validateSchema passes a candidate with a category_code", () => {
  assert.deepEqual(validateSchema(candidate()), []);
});

test("validateReferential flags wrong-licensee-attribution as ERROR", () => {
  const source: DocumentSourceRecord = { documentSourceId: "DERC-TARIFF-ORDERS", sourceLicenseeCode: "BRPL", sourceLicenseeCodes: [] };
  const findings = validateReferential(candidate({ licenseeCode: "BESCOM" }), source);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "ERROR");
  assert.equal(findings[0].layer, "REFERENTIAL");
});

test("validateReferential passes when candidate licensee matches the source's own licensee_code", () => {
  const source: DocumentSourceRecord = { documentSourceId: "DERC-TARIFF-ORDERS", sourceLicenseeCode: "BRPL", sourceLicenseeCodes: [] };
  assert.deepEqual(validateReferential(candidate({ licenseeCode: "BRPL" }), source), []);
});

test("validateReferential passes when candidate licensee is in the source's licensee_codes array", () => {
  const source: DocumentSourceRecord = { documentSourceId: "SHARED-SRC", sourceLicenseeCode: null, sourceLicenseeCodes: ["BESCOM", "MESCOM"] };
  assert.deepEqual(validateReferential(candidate({ licenseeCode: "MESCOM" }), source), []);
});

test("validateEffectiveDate warns when a later unreconciled corrigendum exists", () => {
  const findings = validateEffectiveDate(candidate(), { hasUnreconciledLaterCorrigendum: true });
  assert.ok(findings.some((f) => f.severity === "WARNING" && /corrigendum/i.test(f.message)));
});

test("validateEffectiveDate warns (not errors) on missing orderDate/effectiveFrom", () => {
  const findings = validateEffectiveDate(candidate({ orderDate: null, effectiveFrom: null }), { hasUnreconciledLaterCorrigendum: false });
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.severity === "WARNING"));
});

test("validateUnits flags a DEMAND charge with an energy unit as ERROR", () => {
  const findings = validateUnits(charge({ chargeType: "DEMAND", unit: "INR_PER_KWH" }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "ERROR");
  assert.equal(findings[0].layer, "UNIT");
});

test("validateUnits flags an ENERGY charge with a demand unit as ERROR", () => {
  const findings = validateUnits(charge({ chargeType: "ENERGY", unit: "INR_PER_KW_MONTH" }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "ERROR");
});

test("validateUnits passes a correctly-paired ENERGY/kWh charge", () => {
  assert.deepEqual(validateUnits(charge({ chargeType: "ENERGY", unit: "INR_PER_KWH" })), []);
});

test("validateUnits passes a correctly-paired DEMAND/kW charge", () => {
  assert.deepEqual(validateUnits(charge({ chargeType: "DEMAND", unit: "INR_PER_KW_MONTH" })), []);
});

test("validateProvenance flags a charge with zero field_citations as ERROR", () => {
  const findings = validateProvenance(charge({ citationCount: 0 }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "ERROR");
  assert.equal(findings[0].layer, "PROVENANCE");
});

test("validateProvenance passes a charge with at least one citation", () => {
  assert.deepEqual(validateProvenance(charge({ citationCount: 1 })), []);
});

test("validateCommercialSanity warns (never errors) on an implausibly large per-unit energy value", () => {
  const findings = validateCommercialSanity(charge({ chargeType: "ENERGY", unit: "INR_PER_KWH", value: "45.00" }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "WARNING");
});

test("validateCommercialSanity is silent for a plausible per-unit delta", () => {
  assert.deepEqual(validateCommercialSanity(charge({ chargeType: "ENERGY", unit: "INR_PER_KWH", value: "-0.30" })), []);
});

test("validateCategoryResolution emits one WARNING per unresolvedFields entry, never fabricating a value", () => {
  const findings = validateCategoryResolution(candidate({ rawFields: { unresolvedFields: ["LT-1.absoluteBaseRate", "orderNumber"] } }));
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.severity === "WARNING" && f.layer === "CATEGORY_RESOLUTION"));
});

test("validateCategoryResolution is silent when unresolvedFields is empty", () => {
  assert.deepEqual(validateCategoryResolution(candidate({ rawFields: { unresolvedFields: [] } })), []);
});
