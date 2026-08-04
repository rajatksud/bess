import { BessSystemInput, FinancialInput, SolarInput, CapexBreakdown } from '../types/bess';
import { solarCapex } from './solarProcurement';

/**
 * Turnkey CapEx model.
 *
 * A BESS quote is not a single fixed number - it scales with the two things that are
 * actually being bought:
 *
 *   - the energy block (cells/racks/modules), which scales with rated ENERGY (kWh);
 *   - the power conversion system (PCS/inverter, switchgear, thermal), which scales
 *     with rated POWER (kW);
 *
 * plus a largely size-independent balance-of-plant / EPC component (civil works,
 * container or room, cabling, commissioning, freight), and an optional percentage
 * markup applied to the sum.
 *
 *   totalCapex = (capexPerKwh * ratedEnergyKwh
 *               + capexPerKw  * ratedPowerKw
 *               + balanceOfPlantCost) * (1 + epcMarkupPct / 100)
 *
 * Units: capexPerKwh is currency/kWh, capexPerKw is currency/kW, balanceOfPlantCost
 * and the returned totals are absolute currency amounts, all in the project currency
 * (`TariffInput.currency`). The engine holds no currency conversion - rates must be
 * supplied in the same currency as every other monetary input.
 *
 * `capexModel: 'fixed'` (the default, and what any scenario predating this model
 * resolves to) keeps the legacy behaviour: `financial.initialCapex` is used verbatim
 * and rated power/energy have no effect on it.
 */

/**
 * Resolves the turnkey CapEx breakdown for a system/financial input pair.
 *
 * When `solar` is supplied and procured on site, its investment
 * (installedCapacityKwp * solarCapexPerKwp) is added on top - an on-site array is
 * bought outright, so it belongs in the project's up-front cost. Open-access solar is
 * contracted rather than built and contributes no CapEx; it is charged per kWh
 * instead (see solarProcurement.ts). Omitting `solar` prices the BESS alone.
 */
export function resolveCapexBreakdown(
  system: BessSystemInput,
  financial: FinancialInput,
  solar?: SolarInput
): CapexBreakdown {
  const solarInvestment = solar ? solarCapex(solar) : 0;

  // Absent capexModel means a scenario authored before the derived model existed:
  // preserve its fixed CapEx exactly. A fixed turnkey figure is taken to be the whole
  // project cost as entered, so no solar investment is added on top of it.
  if (financial.capexModel !== 'derived') {
    return {
      model: 'fixed',
      energyCapex: 0,
      powerCapex: 0,
      balanceOfPlantCost: 0,
      epcMarkup: 0,
      solarCapex: 0,
      totalCapex: financial.initialCapex
    };
  }

  // Missing rates resolve to 0 rather than to a hard-coded default, so a derived-mode
  // scenario can never silently inherit reference rates from another currency - a
  // zero/incomplete rate set surfaces through the ZERO_CAPEX validation instead.
  const energyCapex = (financial.capexPerKwh ?? 0) * system.ratedEnergyKwh;
  const powerCapex = (financial.capexPerKw ?? 0) * system.ratedPowerKw;
  const balanceOfPlantCost = financial.balanceOfPlantCost ?? 0;
  const subtotal = energyCapex + powerCapex + balanceOfPlantCost;
  // The EPC markup applies to the BESS scope only. An on-site solar array is quoted
  // and built as its own package, so marking it up again here would inflate it.
  const epcMarkup = subtotal * ((financial.epcMarkupPct ?? 0) / 100);

  return {
    model: 'derived',
    energyCapex,
    powerCapex,
    balanceOfPlantCost,
    epcMarkup,
    solarCapex: solarInvestment,
    totalCapex: subtotal + epcMarkup + solarInvestment
  };
}

/** Convenience accessor for callers that only need the resolved turnkey figure. */
export function resolveTurnkeyCapex(
  system: BessSystemInput,
  financial: FinancialInput,
  solar?: SolarInput
): number {
  return resolveCapexBreakdown(system, financial, solar).totalCapex;
}

/**
 * Returns a FinancialInput whose `initialCapex` holds the resolved turnkey figure and
 * whose model is pinned to 'fixed'. Use this wherever CapEx must be scaled or compared
 * downstream (sensitivity multipliers, scenario comparison) so the multiplier applies
 * to the derived amount rather than to a stale fixed field. Idempotent: applying it to
 * an already-resolved input returns the same total.
 */
export function withResolvedCapex(
  system: BessSystemInput,
  financial: FinancialInput,
  solar?: SolarInput
): FinancialInput {
  return {
    ...financial,
    capexModel: 'fixed',
    initialCapex: resolveTurnkeyCapex(system, financial, solar)
  };
}
