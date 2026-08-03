export type { BatteryModelConfig, DodCycleLifePoint } from './batteryModel';
export { validateBatteryModelConfig, DEFAULT_END_OF_LIFE_SOH_PCT } from './batteryModel';
export type { HalfCycle } from './cycleCounting';
export { extractHalfCycles, equivalentFullCycles, cycleLifeAtDod, cycleLifeConsumption } from './cycleCounting';
export type { DegradationInputs, DegradationResult } from './degradationModel';
export { estimateDegradation } from './degradationModel';
export { DEFAULT_BATTERY_PRESET, BATTERY_PRESET_LIBRARY, findBatteryPreset } from './batteryLibrary';
export type { BatteryModelOverrides } from './systemAdapter';
export {
  toBatteryModelConfig,
  socTraceFromIntervals,
  halfCyclesFromIntervals,
  averageCRateFromIntervals
} from './systemAdapter';
export type { AnnualDutyCycle, SohYear, SohForecast } from './sohForecast';
export { forecastSoh, degradeYear, summariseForecast, usableEnergyKwhAtSoh, SOH_CAPACITY_CONVENTION } from './sohForecast';
