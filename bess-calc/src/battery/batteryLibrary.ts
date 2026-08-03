import { BatteryModelConfig } from './batteryModel';

/**
 * Default preset mirrors src/App.tsx's INITIAL_SYSTEM (125 kW / 261 kWh LFP,
 * 90% usable DoD, 6000 rated cycle life) so a scenario's existing BessSystemInput
 * and its optional Level 2 BatteryModelConfig describe the same physical asset.
 */
export const DEFAULT_BATTERY_PRESET: BatteryModelConfig = {
  manufacturer: 'Generic',
  model: 'LFP-261',
  capacityKwh: 261,
  powerKw: 125,
  roundTripEfficiencyPct: 90, // 95% charge x 95% discharge, matching INITIAL_SYSTEM
  initialSohPct: 100,
  maxCycles: 6000,
  calendarLifeYears: 10
};

export const BATTERY_PRESET_LIBRARY: BatteryModelConfig[] = [DEFAULT_BATTERY_PRESET];

export function findBatteryPreset(model: string): BatteryModelConfig | undefined {
  return BATTERY_PRESET_LIBRARY.find(preset => preset.model === model);
}
