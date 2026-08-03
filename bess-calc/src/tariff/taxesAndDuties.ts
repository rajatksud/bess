import { TaxDutyDefinition, ChargeLine, RoundingRule } from './types';

export interface TaxBase {
  energyCharge: number;
  demandCharge: number;
}

export function applyRounding(value: number, rule: RoundingRule): number {
  if (rule.mode === 'none') return value;
  const factor = Math.pow(10, rule.decimals);
  const scaled = value * factor;
  const rounded = rule.mode === 'up' ? Math.ceil(scaled) : rule.mode === 'down' ? Math.floor(scaled) : Math.round(scaled);
  return rounded / factor;
}

function resolveBaseAmount(base: TaxDutyDefinition['base'], taxBase: TaxBase): number {
  switch (base) {
    case 'energy_charge': return taxBase.energyCharge;
    case 'demand_charge': return taxBase.demandCharge;
    case 'energy_plus_demand': return taxBase.energyCharge + taxBase.demandCharge;
    case 'subtotal': return taxBase.energyCharge + taxBase.demandCharge;
    default: return 0;
  }
}

export function calculateTaxesAndDuties(
  taxes: TaxDutyDefinition[],
  taxBase: TaxBase,
  roundingRule: RoundingRule
): { totalAmount: number; breakdown: ChargeLine[] } {
  const breakdown: ChargeLine[] = taxes.map(tax => {
    const base = resolveBaseAmount(tax.base, taxBase);
    const amount = tax.type === 'percentage'
      ? applyRounding(base * ((tax.rate ?? 0) / 100), roundingRule)
      : applyRounding(tax.fixedAmount ?? 0, roundingRule);
    return {
      label: tax.name,
      quantity: tax.type === 'percentage' ? base : 1,
      unit: tax.type === 'percentage' ? 'currency' : 'fixed',
      rate: tax.type === 'percentage' ? (tax.rate ?? 0) : (tax.fixedAmount ?? 0),
      amount
    };
  });

  const totalAmount = breakdown.reduce((s, l) => s + l.amount, 0);
  return { totalAmount, breakdown };
}
