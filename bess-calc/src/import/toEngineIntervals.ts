// Bridges CSV-imported interval data (IntervalRecordImport, this module's own output
// shape) into the dispatch engine's IntervalRecord input shape (src/types/bess.ts).
// No such bridge existed before - the CSV import pipeline (csvImporter.ts et al.) and
// the dispatch engine (src/engine/dispatchEngine.ts) were never wired together
// anywhere in the app; only synthetic presetProfiles.ts data ever reached the engine.
// Pre-simulation placeholder fields (bessPowerKw: 0, bessSocPct: 80, etc.) and the TOU
// period resolution logic below mirror src/engine/presetProfiles.ts exactly, since
// that is the only existing precedent for constructing a pre-simulation IntervalRecord.
import { IntervalRecordImport } from './types';
import { IntervalRecord, TariffInput } from '../types/bess';
import { resolveTouRate } from '../engine/touPeriods';

function resolveTariffRate(timestamp: Date, tariff: TariffInput) {
  return resolveTouRate(timestamp.getHours() * 60 + timestamp.getMinutes(), tariff);
}

/**
 * Converts validated import records into pre-simulation IntervalRecord[], ready for
 * runIntervalDispatch. Assumes `records` is already validated/accepted output from
 * importIntervalCsv - this function does no validation of its own.
 */
export function toEngineIntervals(records: IntervalRecordImport[], tariff: TariffInput): IntervalRecord[] {
  return records.map((record, index) => {
    const timestamp = new Date(record.timestamp);
    const { importRatePerKwh: importRate, periodName, kind: tariffPeriodKind } = resolveTariffRate(timestamp, tariff);

    const loadKw = record.loadKw;
    const pf = record.powerFactor ?? tariff.powerFactor ?? 0.9;
    const loadKva = record.loadKva ?? (pf > 0 ? loadKw / pf : loadKw);
    const solarKw = record.solarKw ?? 0;
    const gridAvailable = record.gridAvailable ?? true;
    const dgRequiredKw = record.dgKw ?? (gridAvailable ? 0 : loadKw);
    const solarServingLoad = Math.min(solarKw, loadKw);
    const preBessGridImportKw = Math.max(0, loadKw - solarServingLoad);

    return {
      intervalIndex: index,
      timeLabel: `${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}`,
      loadKw,
      loadKva,
      solarKw,
      gridAvailable,
      dgRequiredKw,
      tariffImportRate: importRate,
      tariffPeriod: record.tariffPeriod ?? periodName,
      tariffPeriodKind,

      // Pre-simulation defaults - overwritten by runIntervalDispatch. Mirrors
      // presetProfiles.ts's own defaults exactly for consistency.
      bessPowerKw: 0,
      bessSocPct: 80,
      bessEnergyKwh: 200,
      postBessLoadKw: loadKw,
      postBessLoadKva: loadKva,
      postBessDgKw: dgRequiredKw,
      gridImportKw: gridAvailable ? Math.max(0, loadKw - solarKw) : 0,
      gridExportKw: gridAvailable ? Math.max(0, solarKw - loadKw) : 0,
      solarCurtailedKw: 0,
      bessAction: 'Idle',
      grossSiteLoadKw: loadKw,
      solarGenerationKw: solarKw,
      solarGenerationServingLoadKw: solarServingLoad,
      preBessGridImportKw,
      postBessGridImportKw: preBessGridImportKw,
      batteryChargeKw: 0,
      batteryDischargeKw: 0,
      gridBatteryChargeKw: 0
    };
  });
}
