import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTariff } from "../../src/semanticDiff/diffTariff.js";
import type { DiffTariff } from "../../src/semanticDiff/diffTariff.js";

function tariff(overrides: Partial<DiffTariff> = {}): DiffTariff {
  return {
    jurisdictionCode: "KA",
    licenseeCode: "BESCOM",
    categoryCode: "HT-2A",
    billingEnergyBasis: "KVAH",
    billingDemandBasis: "KVA",
    effectiveFrom: "2025-04-01",
    orderDate: "2025-03-27",
    charges: [
      { chargeType: "ENERGY", value: "7.25", unit: "INR_PER_KVAH" },
      { chargeType: "DEMAND", value: "350.00", unit: "INR_PER_KVA_MONTH" },
    ],
    ...overrides,
  };
}

test("diffTariff with no baseline reports a single NEW_CATEGORY change", () => {
  const changes = diffTariff(tariff(), null);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].changeKind, "NEW_CATEGORY");
  assert.equal(changes[0].commercialImpact, "UNKNOWN");
});

test("diffTariff with an identical candidate and baseline reports CITATION_ONLY", () => {
  const changes = diffTariff(tariff(), tariff());
  assert.equal(changes.length, 1);
  assert.equal(changes[0].changeKind, "CITATION_ONLY");
  assert.equal(changes[0].commercialImpact, "NONE");
});

test("diffTariff detects an energy charge value change as MEDIUM impact", () => {
  const baseline = tariff();
  const candidate = tariff({
    charges: [
      { chargeType: "ENERGY", value: "7.48", unit: "INR_PER_KVAH" },
      { chargeType: "DEMAND", value: "350.00", unit: "INR_PER_KVA_MONTH" },
    ],
  });
  const changes = diffTariff(candidate, baseline);
  const energyChange = changes.find((c) => c.changeKind === "ENERGY_CHARGE_CHANGE");
  assert.ok(energyChange, "expected an ENERGY_CHARGE_CHANGE row");
  assert.equal(energyChange?.commercialImpact, "MEDIUM");
  assert.deepEqual(energyChange?.beforeValue, [{ chargeType: "ENERGY", value: "7.25", unit: "INR_PER_KVAH" }]);
});

test("diffTariff detects an effective-date change", () => {
  const changes = diffTariff(tariff({ effectiveFrom: "2025-05-01" }), tariff());
  const dateChange = changes.find((c) => c.changeKind === "EFFECTIVE_DATE_CHANGE");
  assert.ok(dateChange);
  assert.equal(dateChange?.beforeValue, "2025-04-01");
  assert.equal(dateChange?.afterValue, "2025-05-01");
});

test("diffTariff flags a retrospective correction when effective_from precedes order_date", () => {
  const candidate = tariff({ orderDate: "2025-06-01", effectiveFrom: "2025-01-01" });
  const changes = diffTariff(candidate, tariff({ effectiveFrom: "2025-04-01", orderDate: "2025-03-27" }));
  const retro = changes.find((c) => c.changeKind === "RETROSPECTIVE_CORRECTION");
  assert.ok(retro, "expected a RETROSPECTIVE_CORRECTION when effective date precedes the order date");
  assert.equal(retro?.commercialImpact, "HIGH");
});

test("diffTariff does not flag a retrospective correction for an ordinary forward-dated change", () => {
  const changes = diffTariff(tariff({ effectiveFrom: "2025-05-01", orderDate: "2025-04-20" }), tariff());
  assert.ok(!changes.some((c) => c.changeKind === "RETROSPECTIVE_CORRECTION"));
});

test("diffTariff detects a billing-basis change as HIGH impact", () => {
  const changes = diffTariff(tariff({ billingEnergyBasis: "KWH", billingDemandBasis: "KW" }), tariff());
  const basisChange = changes.find((c) => c.changeKind === "BILLING_BASIS_CHANGE");
  assert.ok(basisChange);
  assert.equal(basisChange?.commercialImpact, "HIGH");
});

test("diffTariff detects a newly introduced charge type", () => {
  const candidate = tariff({
    charges: [...tariff().charges, { chargeType: "FAC_FPPAS", value: "0.85", unit: "INR_PER_KVAH" }],
  });
  const changes = diffTariff(candidate, tariff());
  const facChange = changes.find((c) => c.changeKind === "FAC_FPPAS_CHANGE");
  assert.ok(facChange);
  assert.equal(facChange?.beforeValue, null);
  assert.equal(facChange?.commercialImpact, "HIGH");
});

test("diffTariff detects a removed charge type", () => {
  const baseline = tariff({
    charges: [...tariff().charges, { chargeType: "REBATE", value: "0.10", unit: "PERCENT_OF_ENERGY_CHARGE" }],
  });
  const changes = diffTariff(tariff(), baseline);
  const rebateChange = changes.find((c) => c.changeKind === "REBATE_CHANGE");
  assert.ok(rebateChange);
  assert.equal(rebateChange?.afterValue, null);
  assert.equal(rebateChange?.commercialImpact, "MEDIUM");
});

test("diffTariff groups ToD surcharge/rebate changes under TOD_CHANGE", () => {
  const candidate = tariff({
    charges: [...tariff().charges, { chargeType: "TOD_SURCHARGE", value: "1.20", unit: "INR_PER_KVAH" }],
  });
  const baseline = tariff({
    charges: [...tariff().charges, { chargeType: "TOD_SURCHARGE", value: "1.00", unit: "INR_PER_KVAH" }],
  });
  const changes = diffTariff(candidate, baseline);
  assert.ok(changes.some((c) => c.changeKind === "TOD_CHANGE"));
});

test("diffTariff is order-independent for multiple charges of the same type", () => {
  const a = tariff({
    charges: [
      { chargeType: "ENERGY", value: "7.25", unit: "INR_PER_KVAH" },
      { chargeType: "ENERGY", value: "0.50", unit: "PERCENT_OF_ENERGY_CHARGE" },
    ],
  });
  const b = tariff({
    charges: [
      { chargeType: "ENERGY", value: "0.50", unit: "PERCENT_OF_ENERGY_CHARGE" },
      { chargeType: "ENERGY", value: "7.25", unit: "INR_PER_KVAH" },
    ],
  });
  const changes = diffTariff(a, b);
  assert.ok(!changes.some((c) => c.changeKind === "ENERGY_CHARGE_CHANGE"), "reordered identical charges must not be reported as a change");
});
