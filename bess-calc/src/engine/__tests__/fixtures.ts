import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  IntervalRecord
} from '../../types/bess';

// Mirrors the app's own reference-case defaults (125 kW / 261 kWh LiFePO4 BESS) in
// src/App.tsx INITIAL_* constants, so engine tests exercise the same configuration
// real users see by default rather than an arbitrary made-up fixture.
export function makeSystem(overrides: Partial<BessSystemInput> = {}): BessSystemInput {
  return {
    ratedPowerKw: 125,
    ratedEnergyKwh: 261,
    batteryChemistry: 'LFP',
    usableDodPct: 90,
    minSocPct: 10,
    maxSocPct: 100,
    initialSocPct: 80,
    reserveSocPct: 15,
    chargeEfficiencyPct: 95,
    dischargeEfficiencyPct: 95,
    availabilityPct: 98,
    auxiliaryLoadKw: 2.0,
    annualDegradationPct: 2.0,
    projectLifeYears: 10,
    cycleLife: 6000,
    ...overrides
  };
}

export function makeTariff(overrides: Partial<TariffInput> = {}): TariffInput {
  return {
    currency: '₹',
    energyChargePerKwh: 9.5,
    demandChargePerKvaMonth: 450,
    contractDemandKva: 300,
    billingDemandWindowMinutes: 15,
    powerFactor: 0.90,
    exportCreditPerKwh: 3.0,
    minimumBillingDemandPct: 75,
    demandRatchetPct: 80,
    enableTou: false,
    touPeriods: [],
    ...overrides
  };
}

export function makeDiesel(overrides: Partial<DieselInput> = {}): DieselInput {
  return {
    enableDieselDisplacement: true,
    dgCapacityKva: 250,
    dieselPricePerLitre: 92,
    specificFuelConsumptionLitrePerKwh: 0.28,
    fixedFuelLitresPerHour: 5.0,
    variableFuelLitresPerKwh: 0.24,
    maintenanceCostPerRunHour: 150,
    outageHoursPerMonth: 180,
    avgOutageLoadKw: 120,
    ...overrides
  };
}

export function makeSolar(overrides: Partial<SolarInput> = {}): SolarInput {
  return {
    enableSolarIntegration: true,
    installedCapacityKwp: 150,
    dailySurplusSolarKwh: 240,
    exportAllowed: false,
    exportCreditPerKwh: 3.0,
    curtailmentEnabled: true,
    ...overrides
  };
}

export function makeFinancial(overrides: Partial<FinancialInput> = {}): FinancialInput {
  return {
    initialCapex: 4000000,
    fixedAnnualOm: 200000,
    variableOmPerKwhThroughput: 0.15,
    annualOmEscalationPct: 5.0,
    tariffEscalationPct: 4.0,
    dieselEscalationPct: 5.0,
    discountRatePct: 12.0,
    taxRatePct: 25.0,
    residualValuePct: 10.0,
    ...overrides
  };
}

/** Builds a minimal single-interval IntervalRecord for isolated dispatch tests. */
export function makeInterval(overrides: Partial<IntervalRecord> = {}): IntervalRecord {
  return {
    intervalIndex: 0,
    timeLabel: '00:00',
    loadKw: 0,
    loadKva: 0,
    solarKw: 0,
    gridAvailable: true,
    dgRequiredKw: 0,
    tariffImportRate: 9.5,
    tariffPeriod: 'Standard',
    bessPowerKw: 0,
    bessSocPct: 80,
    bessEnergyKwh: 0,
    postBessLoadKw: 0,
    postBessLoadKva: 0,
    postBessDgKw: 0,
    gridImportKw: 0,
    gridExportKw: 0,
    solarCurtailedKw: 0,
    bessAction: 'Idle',
    ...overrides
  };
}

/** Builds `count` flat 15-minute intervals, all identical apart from index/timeLabel. */
export function makeFlatDay(template: Partial<IntervalRecord>, resolutionMinutes = 15): IntervalRecord[] {
  const count = (24 * 60) / resolutionMinutes;
  return Array.from({ length: count }, (_, i) => {
    const minuteOfDay = i * resolutionMinutes;
    const hour = Math.floor(minuteOfDay / 60);
    const mins = minuteOfDay % 60;
    return makeInterval({
      ...template,
      intervalIndex: i,
      timeLabel: `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    });
  });
}
