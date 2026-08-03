// Battery Model Engine - Level 2 (Engineering) foundation.
//
// Per docs/architecture/BATTERY_MODEL_ARCHITECTURE.md's Level 1/2/3 progression:
// Level 1 (commercial: flat annual % degradation) is what src/engine/dispatchEngine.ts
// and src/optimisation/lpModel.ts already use via a single degradationCostPerKwh
// coefficient - unchanged by this module. Level 3 (physics/digital-twin, e.g. PyBaMM/
// BattMo) is out of scope. This module is Level 2: cycle ageing (DoD/cycle-count/
// C-rate), calendar ageing (elapsed time + a temperature-factor placeholder), and
// throughput ageing, combined into an SOH-over-time estimate.
//
// This is an ENGINEERING approximation, not a physics-accurate model - it uses
// published, standard simplified formulas (DoD-stress weighting, linear calendar
// fade), not a validated electrochemical simulation. Treat outputs as directional
// (useful for comparing scenarios/warranty sanity-checks), not as a warranty
// guarantee or investment-grade physics prediction.
export interface BatteryModelConfig {
  manufacturer: string;
  model: string;
  capacityKwh: number;
  powerKw: number;
  roundTripEfficiencyPct: number; // e.g. 90 (charge x discharge combined)
  initialSohPct: number; // e.g. 100
  maxCycles: number; // rated cycle life at reference DoD (typically 80% DoD to 80% SOH)
  calendarLifeYears: number; // rated calendar life to end-of-life SOH under reference conditions
}

export function validateBatteryModelConfig(config: BatteryModelConfig): void {
  if (config.capacityKwh <= 0) throw new Error('capacityKwh must be positive');
  if (config.powerKw <= 0) throw new Error('powerKw must be positive');
  if (config.roundTripEfficiencyPct <= 0 || config.roundTripEfficiencyPct > 100) {
    throw new Error('roundTripEfficiencyPct must be in (0, 100]');
  }
  if (config.initialSohPct <= 0 || config.initialSohPct > 100) {
    throw new Error('initialSohPct must be in (0, 100]');
  }
  if (config.maxCycles <= 0) throw new Error('maxCycles must be positive');
  if (config.calendarLifeYears <= 0) throw new Error('calendarLifeYears must be positive');
}
