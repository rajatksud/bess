import { IntervalRecord } from '../types/bess';
import { DispatchAttribution, emptyAttribution } from '../engine/savingsAggregator';
import { DispatchInterval } from './types';

/**
 * THE LP ENERGY-ATTRIBUTION RULE.
 *
 * Full write-up, including why the alternatives were rejected:
 * docs/architecture/LP_ENERGY_ATTRIBUTION.md
 *
 * ---------------------------------------------------------------------------------
 * The problem
 * ---------------------------------------------------------------------------------
 * The rule-based engine tags each interval with exactly ONE bessAction, and that tag is
 * what enforces Rule 2 (no double counting): every discharged kWh lands in exactly one
 * avoided-cost bucket. An LP has no such tag. It emits `dischargeKw`, a number chosen to
 * minimise a single scalar objective, with no statement about WHY.
 *
 * Without an attribution rule, the LP path cannot produce a SavingsBreakdown at all
 * without either (a) crediting the same kWh to several categories, which is exactly the
 * double count Rule 2 forbids, or (b) inventing a split with no physical justification.
 *
 * ---------------------------------------------------------------------------------
 * The rule: a marginal-value cascade, each step capped by physical avoidability
 * ---------------------------------------------------------------------------------
 * For each interval t, the LP's discharged energy is consumed by categories in a fixed
 * order, each taking at most the quantity it could physically have avoided in that
 * interval:
 *
 *   1. DIESEL / BACKUP.  Cap = the load that diesel would otherwise have served this
 *      interval (outage load, or an explicitly running DG). During a grid outage there is
 *      no electricity bill to reduce, so avoided diesel is the ONLY value a discharged
 *      kWh can create — this cap is a physical fact, not a preference.
 *
 *   2. PEAK SHAVING.  Cap = max(0, preBessGridImport_t - achievedBillingPeakKw) x dt,
 *      where achievedBillingPeakKw is the highest post-battery meter-side import the
 *      schedule actually attains over the horizon.
 *
 *      This is the load-bearing insight. A demand charge is levied on ONE number: the
 *      billed peak. Energy discharged in an interval whose import was already below the
 *      finally-billed peak changed that number by exactly zero, so it created zero
 *      demand-charge value and MUST NOT be credited with any. Only the area above the
 *      final peak line was responsible for the reduction. Applied to non-outage intervals
 *      only, since an outage interval is not metered.
 *
 *   3. ARBITRAGE.  The residual, monetised at the energy rate.
 *
 * Exhaustive (step 3 absorbs whatever steps 1-2 did not claim) and mutually exclusive
 * (a cascade consumes each kWh once), therefore
 *
 *      dgDisplaced + peakShaving + arbitrageDischarge === totalDischarged
 *
 * holds by construction, which is precisely the Rule 2 invariant that
 * savingsAggregator.attributionViolations checks. The cascade order matches the
 * rule-based engine's DEFAULT priority list, so the two dispatch paths agree about which
 * category a given kWh belongs to whenever they dispatch the same energy.
 *
 * ---------------------------------------------------------------------------------
 * What this rule does NOT claim
 * ---------------------------------------------------------------------------------
 * It does not claim the LP "intended" any of these categories — an LP has no intent, only
 * an objective. It is an ex-post decomposition of realised value, chosen so that the sum
 * of the parts equals the whole and no part is counted twice. The demand-charge SAVING
 * itself is still computed from the peak delta (peakBefore vs peakAfter) in
 * savingsAggregator, exactly as on the rule-based path; the attribution only decides how
 * much energy remains eligible to be monetised AGAIN as arbitrage. That is the mechanism
 * that prevents a kWh earning both a demand credit and an energy credit.
 */

export interface LpAttributionInput {
  /** Original gross-load records, in horizon order. */
  originals: IntervalRecord[];
  /** The optimiser's schedule, aligned index-for-index with `originals`. */
  dispatch: DispatchInterval[];
  intervalMinutes: number;
}

export interface LpAttributionResult {
  attribution: DispatchAttribution;
  /**
   * Per-interval action tags for display. The AUTHORITATIVE attribution is the
   * DispatchAttribution above: a single LP interval can legitimately split across
   * categories, which a one-string tag cannot express. The tag names the largest
   * contributor, and is suffixed "(mixed)" when the interval genuinely split, so a reader
   * is never misled into treating the string as the whole story.
   */
  actionTags: string[];
  /** Meter-side peak the schedule actually attains — the line the peak-shaving cap is measured against. */
  achievedBillingPeakKw: number;
  /** Intervals whose discharge split across more than one category. */
  mixedAttributionIntervals: number;
}

const ACTION_IDLE = 'Idle';
const ACTION_DG = 'Backup / DG Displacement';
const ACTION_PEAK = 'Peak Shaving';
const ACTION_ARBITRAGE = 'TOU Arbitrage Discharge';
const ACTION_SOLAR_CHARGE = 'Solar Surplus Charging';
const ACTION_GRID_CHARGE = 'TOU Off-Peak Charge';

export function attributeLpDispatch(input: LpAttributionInput): LpAttributionResult {
  const { originals, dispatch, intervalMinutes } = input;
  if (originals.length !== dispatch.length) {
    throw new Error(`Dispatch schedule length (${dispatch.length}) does not match the interval count (${originals.length})`);
  }
  const dtHours = intervalMinutes / 60;

  // Pass 1 — physical quantities that do not depend on the attribution, including the
  // achieved billing peak the peak-shaving cap is measured against. The peak must be
  // known before any energy can be attributed, which is why this is a two-pass algorithm.
  const preBessGridImportKw: number[] = [];
  const postBessGridImportKw: number[] = [];
  let achievedBillingPeakKw = 0;

  originals.forEach((original, index) => {
    const scheduled = dispatch[index];
    const solarServingLoadKw = Math.min(Math.max(original.solarKw, 0), Math.max(original.loadKw, 0));
    const preImport = Math.max(original.loadKw - solarServingLoadKw, 0);

    const dischargeKw = Math.max(0, scheduled.dischargeKw);
    const chargeKw = Math.max(0, scheduled.chargeKw);
    const surplusSolarKw = Math.max(0, original.solarKw - original.loadKw);
    const gridChargeKw = Math.max(0, chargeKw - Math.min(chargeKw, surplusSolarKw));
    const postImport = Math.max(preImport - dischargeKw + gridChargeKw, 0);

    preBessGridImportKw.push(preImport);
    postBessGridImportKw.push(postImport);

    // Only metered (non-outage) intervals set the billed peak.
    if (original.gridAvailable && postImport > achievedBillingPeakKw) {
      achievedBillingPeakKw = postImport;
    }
  });

  // Pass 2 — the cascade.
  const attribution: DispatchAttribution = emptyAttribution();
  const actionTags: string[] = [];
  let mixedAttributionIntervals = 0;

  originals.forEach((original, index) => {
    const scheduled = dispatch[index];
    const dischargeKw = Math.max(0, scheduled.dischargeKw);
    const chargeKw = Math.max(0, scheduled.chargeKw);

    if (dischargeKw <= 0 && chargeKw <= 0) {
      actionTags.push(ACTION_IDLE);
      return;
    }

    if (chargeKw > 0) {
      const chargedKwh = chargeKw * dtHours;
      const surplusSolarKw = Math.max(0, original.solarKw - original.loadKw);
      const solarSourcedKwh = Math.min(chargedKwh, surplusSolarKw * dtHours);
      const gridSourcedKwh = chargedKwh - solarSourcedKwh;

      attribution.totalChargedKwh += chargedKwh;
      attribution.solarStoredKwh += solarSourcedKwh;
      attribution.gridChargedKwh += gridSourcedKwh;
      // Every grid-sourced kWh stored by the optimiser is stored to be sold back later at
      // a better rate — that is the only reason an optimiser minimising cost would ever
      // pay to charge. It is therefore arbitrage charge in full. (The aggregator prices
      // charging from gridChargedKwh regardless; this field exists for the invariant
      // check that arbitrage charge never exceeds total grid charge.)
      attribution.arbitrageChargedKwh += gridSourcedKwh;

      if (solarSourcedKwh > 0 && gridSourcedKwh > 0) mixedAttributionIntervals++;
      actionTags.push(solarSourcedKwh >= gridSourcedKwh ? ACTION_SOLAR_CHARGE : ACTION_GRID_CHARGE);
      return;
    }

    // ---- Discharge cascade ----
    const dischargedKwh = dischargeKw * dtHours;
    attribution.totalDischargedKwh += dischargedKwh;
    let remainingKwh = dischargedKwh;

    // 1. Diesel / backup. During an outage every discharged kWh serves load diesel would
    //    otherwise have served. Outside an outage, only an explicitly running DG can be
    //    displaced.
    const dieselAvoidableKwh = original.gridAvailable
      ? Math.max(0, original.dgRequiredKw) * dtHours
      : Math.max(0, original.loadKw) * dtHours;
    const dgKwh = Math.min(remainingKwh, dieselAvoidableKwh);
    remainingKwh -= dgKwh;

    // 2. Peak shaving, capped by the energy above the achieved billing peak. Not
    //    applicable during an outage: an unmetered interval cannot set or reduce a
    //    demand charge.
    const peakAvoidableKwh = original.gridAvailable
      ? Math.max(0, preBessGridImportKw[index] - achievedBillingPeakKw) * dtHours
      : 0;
    const peakKwh = Math.min(remainingKwh, peakAvoidableKwh);
    remainingKwh -= peakKwh;

    // 3. Arbitrage takes the residual, which makes the decomposition exhaustive.
    const arbitrageKwh = remainingKwh;

    attribution.dgDisplacedKwh += dgKwh;
    attribution.peakShavingKwh += peakKwh;
    attribution.arbitrageDischargeKwh += arbitrageKwh;

    const contributions: Array<[string, number]> = [
      [ACTION_DG, dgKwh],
      [ACTION_PEAK, peakKwh],
      [ACTION_ARBITRAGE, arbitrageKwh]
    ];
    const nonZero = contributions.filter(([, kwh]) => kwh > 0);
    if (nonZero.length > 1) mixedAttributionIntervals++;
    const dominant = contributions.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
    actionTags.push(nonZero.length > 1 ? `${dominant[0]} (mixed)` : dominant[0]);
  });

  // Unserved backup load and curtailed solar are physical outcomes, independent of the
  // attribution cascade, but the aggregator needs them.
  originals.forEach((original, index) => {
    const scheduled = dispatch[index];
    const dischargeKw = Math.max(0, scheduled.dischargeKw);
    const chargeKw = Math.max(0, scheduled.chargeKw);

    if (!original.gridAvailable) {
      const unservedKw = Math.max(0, original.loadKw - dischargeKw);
      attribution.unservedBackupKwh += unservedKw * dtHours;
    }

    const solarServingLoadKw = Math.min(Math.max(original.solarKw, 0), Math.max(original.loadKw, 0));
    const surplusSolarKw = Math.max(0, original.solarKw - original.loadKw);
    const solarSourcedChargeKw = Math.min(chargeKw, surplusSolarKw);
    const absorbedKw = solarServingLoadKw + solarSourcedChargeKw;
    if (original.solarKw > absorbedKw) {
      attribution.curtailedSolarKwh += (original.solarKw - absorbedKw) * dtHours;
    }
  });

  return {
    attribution,
    actionTags,
    achievedBillingPeakKw,
    mixedAttributionIntervals
  };
}
