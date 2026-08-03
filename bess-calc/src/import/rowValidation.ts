import { RowError, IntervalRecordImport } from './types';

/**
 * Neutralises spreadsheet-formula-injection payloads for values that will be written
 * back into a CSV error report (Excel/Sheets treat a leading =, +, -, @, or tab as the
 * start of a formula). Only applied to values destined for a re-exported error report
 * — never to numeric values used in calculation.
 */
export function neutraliseForSpreadsheet(value: string): string {
  if (/^[=+\-@\t]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export interface RawRow {
  [column: string]: string | undefined;
}

export interface ParsedRowFields {
  timestamp?: string;
  loadKw?: number;
  loadKva?: number;
  powerFactor?: number;
  solarKw?: number;
  dgKw?: number;
  gridAvailable?: boolean;
  tariffPeriod?: string;
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN; // NaN signals "present but invalid", not "absent"
}

function parseOptionalBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const v = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return undefined; // caller treats as invalid via a dedicated check if the column was present
}

/**
 * Validates a single parsed row's numeric/logical constraints (NOT timestamp parsing,
 * which is handled separately since it needs the tariff timezone). Returns errors (or
 * warnings, in permissive mode) plus the coerced field values where valid.
 */
export function validateRowFields(
  raw: RawRow,
  rowNumber: number,
  mode: 'strict' | 'permissive',
  kvaToleranceKw = 0.5
): { fields: ParsedRowFields; issues: RowError[] } {
  const issues: RowError[] = [];
  const level = mode === 'strict' ? 'error' : 'warning';

  const loadKwRaw = raw.load_kw;
  const loadKw = parseOptionalNumber(loadKwRaw);
  if (loadKw === undefined) {
    issues.push({ rowNumber, level: 'error', code: 'MISSING_LOAD', message: 'load_kw is required and missing.' });
  } else if (Number.isNaN(loadKw)) {
    issues.push({ rowNumber, level: 'error', code: 'INVALID_LOAD', message: `load_kw is not numeric: "${loadKwRaw}"`, rawValue: loadKwRaw });
  } else if (loadKw < 0) {
    issues.push({ rowNumber, level: 'error', code: 'NEGATIVE_LOAD', message: `load_kw cannot be negative: ${loadKw}` });
  }

  const loadKva = parseOptionalNumber(raw.load_kva);
  if (loadKva !== undefined && Number.isNaN(loadKva)) {
    issues.push({ rowNumber, level, code: 'INVALID_KVA', message: `load_kva is not numeric: "${raw.load_kva}"`, rawValue: raw.load_kva });
  }

  const powerFactor = parseOptionalNumber(raw.power_factor);
  if (powerFactor !== undefined) {
    if (Number.isNaN(powerFactor) || powerFactor <= 0 || powerFactor > 1) {
      issues.push({ rowNumber, level, code: 'INVALID_PF', message: `power_factor must be in (0, 1]: "${raw.power_factor}"`, rawValue: raw.power_factor });
    }
  }

  const solarKw = parseOptionalNumber(raw.solar_kw);
  if (solarKw !== undefined) {
    if (Number.isNaN(solarKw)) {
      issues.push({ rowNumber, level, code: 'INVALID_SOLAR', message: `solar_kw is not numeric: "${raw.solar_kw}"`, rawValue: raw.solar_kw });
    } else if (solarKw < 0) {
      issues.push({ rowNumber, level, code: 'NEGATIVE_SOLAR', message: `solar_kw cannot be negative: ${solarKw}` });
    }
  }

  const dgKw = parseOptionalNumber(raw.dg_kw);
  if (dgKw !== undefined && Number.isNaN(dgKw)) {
    issues.push({ rowNumber, level, code: 'INVALID_DG', message: `dg_kw is not numeric: "${raw.dg_kw}"`, rawValue: raw.dg_kw });
  }

  let gridAvailable: boolean | undefined;
  if (raw.grid_available !== undefined && raw.grid_available.trim() !== '') {
    gridAvailable = parseOptionalBoolean(raw.grid_available);
    if (gridAvailable === undefined) {
      issues.push({ rowNumber, level, code: 'INVALID_GRID_AVAILABLE', message: `grid_available is not a recognised boolean: "${raw.grid_available}"`, rawValue: raw.grid_available });
    }
  }

  // kVA must not be below kW beyond a small tolerance (kVA >= kW always, physically).
  if (loadKw !== undefined && !Number.isNaN(loadKw) && loadKva !== undefined && !Number.isNaN(loadKva)) {
    if (loadKva < loadKw - kvaToleranceKw) {
      issues.push({
        rowNumber,
        level,
        code: 'KVA_BELOW_KW',
        message: `load_kva (${loadKva}) is below load_kw (${loadKw}) beyond tolerance; kVA must be >= kW.`
      });
    }
  }

  return {
    fields: {
      timestamp: raw.timestamp,
      loadKw: Number.isNaN(loadKw) ? undefined : loadKw,
      loadKva: Number.isNaN(loadKva) ? undefined : loadKva,
      powerFactor: Number.isNaN(powerFactor) ? undefined : powerFactor,
      solarKw: Number.isNaN(solarKw) ? undefined : solarKw,
      dgKw: Number.isNaN(dgKw) ? undefined : dgKw,
      gridAvailable,
      tariffPeriod: raw.tariff_period
    },
    issues
  };
}

/** Detects duplicate and out-of-order timestamps across an already-parsed, ordered record list. */
export function detectDuplicatesAndOrder(records: IntervalRecordImport[]): { duplicates: RowError[]; outOfOrder: RowError[] } {
  const duplicates: RowError[] = [];
  const outOfOrder: RowError[] = [];
  const seen = new Map<string, number>();
  let lastMs = -Infinity;

  for (const rec of records) {
    const ms = Date.parse(rec.timestamp);
    if (seen.has(rec.timestamp)) {
      duplicates.push({
        rowNumber: rec.rowNumber,
        level: 'error',
        code: 'DUPLICATE_TIMESTAMP',
        message: `Duplicate timestamp ${rec.timestamp} (first seen at row ${seen.get(rec.timestamp)}).`
      });
    } else {
      seen.set(rec.timestamp, rec.rowNumber);
    }
    if (ms < lastMs) {
      outOfOrder.push({
        rowNumber: rec.rowNumber,
        level: 'error',
        code: 'OUT_OF_ORDER_TIMESTAMP',
        message: `Timestamp ${rec.timestamp} is out of chronological order relative to the preceding row.`
      });
    } else {
      lastMs = ms;
    }
  }

  return { duplicates, outOfOrder };
}
