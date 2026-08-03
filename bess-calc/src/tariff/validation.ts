import { TariffDefinition, BillingWarning } from './types';

/** True if `asOfDate` (ISO) falls within [effectiveFrom, effectiveTo]. */
export function isTariffEffective(tariff: TariffDefinition, asOfDate: string): boolean {
  const asOf = Date.parse(asOfDate);
  const from = Date.parse(tariff.effectiveFrom);
  if (Number.isNaN(asOf) || Number.isNaN(from)) return false;
  if (asOf < from) return false;
  if (tariff.effectiveTo) {
    const to = Date.parse(tariff.effectiveTo);
    if (!Number.isNaN(to) && asOf > to) return false;
  }
  return true;
}

export function validateTariffApplicability(tariff: TariffDefinition, asOfDate: string): BillingWarning[] {
  const warnings: BillingWarning[] = [];

  if (!isTariffEffective(tariff, asOfDate)) {
    warnings.push({
      code: 'TARIFF_NOT_EFFECTIVE',
      level: 'error',
      message: `Tariff "${tariff.name}" (${tariff.id}) is not effective on ${asOfDate}. Effective ${tariff.effectiveFrom}${tariff.effectiveTo ? ` to ${tariff.effectiveTo}` : ' (open-ended)'}.`
    });
  }

  const unsatisfied = tariff.applicabilityConditions.filter(c => !c.satisfied);
  for (const cond of unsatisfied) {
    warnings.push({
      code: 'APPLICABILITY_CONDITION_NOT_MET',
      level: 'warning',
      message: `Tariff applicability condition not confirmed: ${cond.description}`
    });
  }

  return warnings;
}

/**
 * Validates that a source interval cadence is compatible with the tariff's demand
 * integration window. Per the demand-aggregation rules:
 *  - cadence === window: use interval average directly (no warning)
 *  - cadence evenly divides window: energy-weighted aggregation is required (warning to
 *    remind callers this must happen, not an error)
 *  - cadence coarser than window: reject/flag as non-engineering-grade
 */
export function validateDemandIntegrationCompatibility(
  sourceCadenceMinutes: number,
  demandIntegrationWindowMinutes: number
): BillingWarning[] {
  const warnings: BillingWarning[] = [];

  if (sourceCadenceMinutes === demandIntegrationWindowMinutes) {
    return warnings;
  }

  if (sourceCadenceMinutes < demandIntegrationWindowMinutes) {
    if (demandIntegrationWindowMinutes % sourceCadenceMinutes !== 0) {
      warnings.push({
        code: 'CADENCE_DOES_NOT_DIVIDE_WINDOW',
        level: 'error',
        message: `Source cadence (${sourceCadenceMinutes} min) does not evenly divide the demand integration window (${demandIntegrationWindowMinutes} min). Maximum-demand calculation cannot be treated as engineering-grade.`
      });
    } else {
      warnings.push({
        code: 'DEMAND_AGGREGATION_REQUIRED',
        level: 'info',
        message: `Source cadence (${sourceCadenceMinutes} min) is finer than the demand integration window (${demandIntegrationWindowMinutes} min); intervals are energy-weighted-averaged into ${demandIntegrationWindowMinutes}-minute windows before computing maximum demand.`
      });
    }
    return warnings;
  }

  // sourceCadenceMinutes > demandIntegrationWindowMinutes: source is coarser than the
  // window the tariff bills on. An instantaneous/coarse reading cannot be substituted
  // for a true integrating-window maximum demand.
  warnings.push({
    code: 'CADENCE_COARSER_THAN_WINDOW',
    level: 'error',
    message: `Source cadence (${sourceCadenceMinutes} min) is coarser than the tariff's demand integration window (${demandIntegrationWindowMinutes} min). A ${sourceCadenceMinutes}-minute reading cannot be substituted for a true ${demandIntegrationWindowMinutes}-minute integrating maximum demand; treat any resulting demand-charge figure as non-engineering-grade.`
  });

  return warnings;
}
