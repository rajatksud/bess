import { 
  BessSystemInput, 
  TariffInput, 
  DieselInput, 
  SolarInput, 
  FinancialInput, 
  SimulationResult 
} from '../types/bess';

export function runLegacySalesPitchCalculation(
  system: BessSystemInput,
  tariff: TariffInput,
  diesel: DieselInput,
  solar: SolarInput,
  financial: FinancialInput
): {
  salesPitchAnnualSavings: number;
  salesPitchPaybackYears: number;
  breakdown: {
    demandSavings: number;
    dieselSavings: number;
    solarSavings: number;
  };
  flaws: Array<{ number: number; title: string; description: string }>;
} {
  // Reference Sales Pitch Arithmetic from section 2 of specification:
  
  // 1. Unconstrained Demand Reduction: Assumes 125 kW peak reduction on 300 kVA contract demand
  // Demand charge: ₹450 / kVA / month * 125 kW * 12 months = ₹675,000 / yr
  const demandSavings = (system.ratedPowerKw) * tariff.demandChargePerKvaMonth * 12;

  // 2. Unconstrained Diesel Displacement: Assumes full 261 kWh nameplate capacity discharged every day for DG
  // 261 kWh/day * 365 days = 95,265 kWh/yr * 0.28 L/kWh * ₹92/L = ₹2,453,926 / yr
  const dailyDgKwh = system.ratedEnergyKwh;
  const annualDgLitres = dailyDgKwh * 365 * (diesel.specificFuelConsumptionLitrePerKwh || 0.28);
  const dieselSavings = annualDgLitres * diesel.dieselPricePerLitre;

  // 3. Unconstrained Surplus Solar Utilization: Assumes another 180 kWh/day excess solar absorbed and discharged
  // 180 kWh/day * 365 days = 65,700 kWh/yr * ₹9.5/kWh = ₹624,150 / yr
  const dailySolarKwh = Math.min(200, solar.dailySurplusSolarKwh || 200);
  const solarSavings = dailySolarKwh * 365 * tariff.energyChargePerKwh;

  const salesPitchAnnualSavings = demandSavings + dieselSavings + solarSavings;
  const salesPitchPaybackYears = Math.round((financial.initialCapex / salesPitchAnnualSavings) * 100) / 100;

  const flaws = [
    {
      number: 1,
      title: 'Double Counting Battery Capacity',
      description: 'Allocates the full 261 kWh battery to diesel displacement, AND another 200 kWh/day to solar absorption, AND unrestricted peak shaving on the exact same day.'
    },
    {
      number: 2,
      title: 'kW and kVA Treated as Interchangeable',
      description: 'Calculates demand bill savings using kW directly against a ₹/kVA utility tariff without accounting for site power factor (e.g. 0.90 PF requires 138 kVA to deliver 125 kW).'
    },
    {
      number: 3,
      title: 'Omission of Grid Charging Costs',
      description: 'Calculates energy discharge savings without deducting the electricity cost or round-trip efficiency losses required to charge the battery.'
    },
    {
      number: 4,
      title: 'Nameplate vs Deliverable Energy',
      description: 'Uses 100% nameplate capacity (261 kWh) without applying Depth of Discharge limits (90% DoD), inverter efficiency (95%), or BMS reserve capacity.'
    },
    {
      number: 5,
      title: 'Ignoring Outage Schedules & Fixed DG Factors',
      description: 'Assumes daily diesel displacement even when no grid outage occurs, using a constant 0.28 L/kWh regardless of generator loading curve.'
    },
    {
      number: 6,
      title: 'Dimensional Error in Solar Calculation',
      description: 'Subtractions like "Excess Solar = 240 kWh - 120 kW" mix energy (kWh) and power (kW) incorrectly rather than integrating interval power.'
    },
    {
      number: 7,
      title: 'Simple Multiplication as 10-Year Profit',
      description: 'Multiplies Year 1 gross saving by 10, ignoring battery capacity degradation (~2%/yr), O&M escalation, inverter replacement, and discount rate.'
    },
    {
      number: 8,
      title: 'Omission of Auxiliary Power & O&M',
      description: 'Ignores continuous HVAC and BMS auxiliary power consumption (~2 kW continuous) and fixed annual system maintenance.'
    },
    {
      number: 9,
      title: 'Peak Shaving Integration Window',
      description: 'Assumes instantaneous 125 kW reduction translates to bill savings without verifying if the battery can sustain output across the full 15-min utility billing window.'
    },
    {
      number: 10,
      title: 'Incomplete Investment Return Metrics',
      description: 'Presents simple annual payback without calculating Net Present Value (NPV), Internal Rate of Return (IRR), or Levelized Cost of Storage (LCOS).'
    }
  ];

  return {
    salesPitchAnnualSavings,
    salesPitchPaybackYears,
    breakdown: {
      demandSavings,
      dieselSavings,
      solarSavings
    },
    flaws
  };
}
