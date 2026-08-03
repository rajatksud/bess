import { TariffDefinition } from '../types';

// ============================================================================
// SAMPLE — Illustrative Generic Indian C&I HT Tariff
// NOT A LIVE DISCOM TARIFF. Structurally representative of a typical Indian state
// DISCOM HT industrial tariff (energy + TOD + demand + PF surcharge shape), but the
// specific rates below are illustrative placeholders for testing and demos only.
// Do not use for real billing or investment decisions without substituting an
// authoritative, dated tariff order.
// ============================================================================
export const SAMPLE_GENERIC_INDIA_CI_HT_TARIFF: TariffDefinition = {
  id: 'sample-india-ci-ht-generic',
  name: 'SAMPLE — Illustrative Generic Indian C&I HT Tariff',
  source: 'SAMPLE — not sourced from a real tariff order',
  version: '1.0.0-sample',
  effectiveFrom: '2024-04-01',
  jurisdiction: 'SAMPLE',
  utility: 'SAMPLE DISCOM',
  consumerCategory: 'HT Industrial',
  voltageLevel: '11kV',
  timezone: 'Asia/Kolkata',
  currency: '₹',
  billingCycle: 'monthly',
  billingUnit: 'kVA',
  demandIntegrationWindowMinutes: 30,
  energyCharges: {
    type: 'tod',
    todPeriods: [
      { id: 'peak', name: 'Peak (18:00-22:00)', startTime: '18:00', endTime: '22:00', ratePerKwh: 11.5 },
      { id: 'off-peak', name: 'Off-Peak (22:00-06:00)', startTime: '22:00', endTime: '06:00', ratePerKwh: 6.5 },
      { id: 'normal', name: 'Normal (06:00-18:00)', startTime: '06:00', endTime: '18:00', ratePerKwh: 8.5 }
    ]
  },
  demandCharges: {
    basis: 'contract_demand',
    ratePerKva: 450,
    contractDemandKva: 300,
    minimumBillingDemandPct: 75
  },
  exportRules: {
    policy: 'net_metering',
    creditPerKwh: 3.5
  },
  taxesAndDuties: [
    { id: 'electricity-duty', name: 'Electricity Duty', type: 'percentage', rate: 9, base: 'energy_charge' },
    { id: 'fixed-meter-charge', name: 'Fixed Meter Charge', type: 'fixed', fixedAmount: 500, base: 'subtotal' }
  ],
  applicabilityConditions: [
    { description: 'Sanctioned/contract demand does not exceed 300 kVA', satisfied: true }
  ],
  roundingRule: { mode: 'nearest', decimals: 2 }
};

// ============================================================================
// SAMPLE — Illustrative Flat-Rate Commercial Tariff (simple baseline fixture)
// NOT A LIVE DISCOM TARIFF.
// ============================================================================
export const SAMPLE_FLAT_COMMERCIAL_TARIFF: TariffDefinition = {
  id: 'sample-flat-commercial',
  name: 'SAMPLE — Illustrative Flat-Rate Commercial Tariff',
  source: 'SAMPLE — not sourced from a real tariff order',
  version: '1.0.0-sample',
  effectiveFrom: '2024-01-01',
  jurisdiction: 'SAMPLE',
  consumerCategory: 'Commercial LT',
  voltageLevel: '415V',
  timezone: 'Asia/Kolkata',
  currency: '₹',
  billingCycle: 'monthly',
  billingUnit: 'kW',
  demandIntegrationWindowMinutes: 15,
  energyCharges: {
    type: 'flat',
    flatRatePerKwh: 9.0
  },
  demandCharges: {
    basis: 'measured_maximum',
    ratePerKw: 350
  },
  exportRules: {
    policy: 'prohibited'
  },
  taxesAndDuties: [
    { id: 'electricity-duty', name: 'Electricity Duty', type: 'percentage', rate: 6, base: 'energy_charge' }
  ],
  applicabilityConditions: [],
  roundingRule: { mode: 'nearest', decimals: 2 }
};
