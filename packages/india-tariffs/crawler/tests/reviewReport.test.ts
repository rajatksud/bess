import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingBaseRateFlags } from "../src/review/reviewReport.js";

/**
 * findMissingBaseRateFlags() is the structural check behind
 * review-report's per-candidate FLAGS section: a REBATE or surcharge
 * charge with no corresponding ADDITIVE (base-rate) row of the same type
 * cannot be billed. This directly guards against the bug found in the real
 * KERC extraction, where every ENERGY charge across all 60 categories was a
 * REBATE (a year-on-year delta from the order's revision narrative) with no
 * absolute base rate ever extracted.
 */

test("flags an ENERGY charge set with only a REBATE row and no ADDITIVE base rate", () => {
  const flags = findMissingBaseRateFlags([{ charge_type: "ENERGY", behaviour: "REBATE" }]);
  assert.equal(flags.length, 1);
  assert.match(flags[0], /No ADDITIVE \(base-rate\) ENERGY charge found/);
  assert.match(flags[0], /An energy rebate\/surcharge/);
});

test("does not flag an ENERGY charge set that includes an ADDITIVE base rate alongside a rebate", () => {
  const flags = findMissingBaseRateFlags([
    { charge_type: "ENERGY", behaviour: "ADDITIVE" },
    { charge_type: "ENERGY", behaviour: "REBATE" },
  ]);
  assert.equal(flags.length, 0);
});

test("flags a DEMAND charge set with only a REBATE row, uses 'A' article not 'An'", () => {
  const flags = findMissingBaseRateFlags([{ charge_type: "DEMAND", behaviour: "REBATE" }]);
  assert.equal(flags.length, 1);
  assert.match(flags[0], /A demand rebate\/surcharge/);
});

test("does not flag charge types other than ENERGY/DEMAND even without an ADDITIVE row", () => {
  const flags = findMissingBaseRateFlags([{ charge_type: "OTHER", behaviour: "ADDITIVE" }]);
  assert.equal(flags.length, 0);
});

test("does not flag when there are no charges of a given type at all", () => {
  const flags = findMissingBaseRateFlags([{ charge_type: "FIXED", behaviour: "ADDITIVE" }]);
  assert.equal(flags.length, 0);
});

test("can flag both ENERGY and DEMAND independently in the same candidate", () => {
  const flags = findMissingBaseRateFlags([
    { charge_type: "ENERGY", behaviour: "REBATE" },
    { charge_type: "DEMAND", behaviour: "MULTIPLICATIVE" },
  ]);
  assert.equal(flags.length, 2);
});
