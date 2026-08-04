import { SolarInput, SolarProcurementModel } from '../types/bess';

/**
 * Solar procurement cost model.
 *
 * The governing principle: the site pays for the ENTIRE procured capacity, not just
 * the share it manages to consume. Under either procurement route a generated kWh has
 * already been paid for by the time it reaches the site, so curtailing it recovers
 * nothing - curtailment is a cash loss, not just a technical inefficiency.
 *
 *   'onsite_capex' — paid once, up front: installedCapacityKwp * solarCapexPerKwp,
 *                    folded into the project's turnkey CapEx (see capexModel.ts).
 *                    Per-kWh running cost is therefore zero; the energy is sunk.
 *   'open_access'  — paid per kWh contracted: contractedTariffPerKwh plus
 *                    openAccessChargesPerKwh (wheeling, banking, cross-subsidy and
 *                    additional surcharges), charged on ALL generation.
 *
 * Both figures are reported at project level. They are deliberately NOT deducted from
 * the BESS's net operating saving, because the solar cost is identical in the baseline
 * and with-BESS cases - it is common to both and cancels in a BESS-attributable
 * comparison. What the battery actually changes is how much of that paid-for energy is
 * rescued rather than curtailed; that shows up as solar self-consumption saving.
 */

const DAYS_IN_YEAR = 365;

export function solarProcurementModelOf(solar: SolarInput): SolarProcurementModel {
  return solar.procurementModel ?? 'onsite_capex';
}

/**
 * Delivered cost of one generated kWh under the configured route.
 *
 * Zero for on-site, where generation is paid for through CapEx rather than per kWh -
 * charging both would double-count the same capacity.
 */
export function solarUnitCostPerKwh(solar: SolarInput): number {
  if (!solar.enableSolarIntegration) return 0;
  if (solarProcurementModelOf(solar) !== 'open_access') return 0;
  return (solar.contractedTariffPerKwh ?? 0) + (solar.openAccessChargesPerKwh ?? 0);
}

/**
 * Up-front solar investment, currency. Non-zero only for the on-site route; open
 * access is contracted rather than built, so it carries no CapEx.
 */
export function solarCapex(solar: SolarInput): number {
  if (!solar.enableSolarIntegration) return 0;
  if (solarProcurementModelOf(solar) !== 'onsite_capex') return 0;
  return Math.max(0, solar.installedCapacityKwp) * (solar.solarCapexPerKwp ?? 0);
}

export interface SolarProcurementCost {
  model: SolarProcurementModel;
  /** Delivered cost of one generated kWh (0 under the on-site route). */
  unitCostPerKwh: number;
  /** Up-front investment (0 under the open-access route). */
  capex: number;
  /** Annual cost of the ENTIRE generation, consumed or not. */
  annualEnergyCost: number;
  /** The share of annualEnergyCost paid for generation that was curtailed - pure waste. */
  annualCurtailedCost: number;
}

/**
 * Prices a simulated year's solar generation. `annualGeneratedKwh` must be TOTAL
 * generation (self-consumed + stored + exported + curtailed), since the whole
 * contracted capacity is paid for regardless of what happens to each kWh.
 */
export function priceSolarProcurement(
  solar: SolarInput,
  annualGeneratedKwh: number,
  annualCurtailedKwh: number
): SolarProcurementCost {
  const unitCostPerKwh = solarUnitCostPerKwh(solar);
  return {
    model: solarProcurementModelOf(solar),
    unitCostPerKwh,
    capex: solarCapex(solar),
    annualEnergyCost: Math.max(0, annualGeneratedKwh) * unitCostPerKwh,
    annualCurtailedCost: Math.max(0, annualCurtailedKwh) * unitCostPerKwh
  };
}

/** Daily-to-annual helper, kept here so the 365 factor is stated in exactly one place. */
export function annualiseDaily(dailyValue: number): number {
  return dailyValue * DAYS_IN_YEAR;
}
