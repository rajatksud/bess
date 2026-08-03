import Papa from 'papaparse';
import {
  ImportOptions,
  ImportResult,
  ImportSummary,
  IntervalRecordImport,
  RowError,
  ImportWarning,
  DEFAULT_IMPORT_LIMITS,
  DEFAULT_COLUMN_MAPPING
} from './types';
import { parseTimestamp, detectDstAnomaly } from './timestampUtils';
import { validateRowFields, detectDuplicatesAndOrder, RawRow } from './rowValidation';
import { detectCadence, detectMissingIntervals } from './cadence';

const REQUIRED_COLUMNS = ['timestamp', 'load_kw'];
const KNOWN_COLUMNS = new Set([
  'timestamp', 'load_kw', 'load_kva', 'power_factor', 'solar_kw', 'dg_kw', 'grid_available', 'tariff_period'
]);

function defaultOptions(overrides: Partial<ImportOptions>): ImportOptions {
  return {
    columnMapping: DEFAULT_COLUMN_MAPPING,
    limits: DEFAULT_IMPORT_LIMITS,
    mode: 'permissive',
    tariffTimezone: 'UTC',
    allowIrregular: false,
    ...overrides
  };
}

/**
 * Parses and validates a CSV interval-data file. Synchronous, bounded by the configured
 * limits (file size / row count / parse duration / max returned errors). Uses Papa
 * Parse for RFC-4180-correct tokenising (quoted fields, embedded commas, CRLF/LF,
 * blank lines, BOM) rather than a hand-written splitter.
 */
export function importIntervalCsv(csvText: string, optionsOverride: Partial<ImportOptions> = {}): ImportResult {
  const options = defaultOptions(optionsOverride);
  const startedAt = Date.now();

  const byteLength = new TextEncoder().encode(csvText).length;
  if (byteLength > options.limits.maxFileSizeBytes) {
    return emptyResultWithError(
      'FILE_TOO_LARGE',
      `File size ${byteLength} bytes exceeds the maximum allowed ${options.limits.maxFileSizeBytes} bytes.`
    );
  }

  const parsed = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase().replace(/^﻿/, ''), // BOM-safe header normalisation
    dynamicTyping: false
  });

  if (parsed.data.length > options.limits.maxRowCount) {
    return emptyResultWithError(
      'TOO_MANY_ROWS',
      `Row count ${parsed.data.length} exceeds the maximum allowed ${options.limits.maxRowCount}.`
    );
  }

  const warnings: ImportWarning[] = [];
  const rowErrors: RowError[] = [];

  // Malformed-row parser errors (Papa Parse reports these with 1-indexed row references).
  for (const err of parsed.errors) {
    if (err.code === 'TooFewFields' || err.code === 'TooManyFields') {
      rowErrors.push({
        rowNumber: (err.row ?? 0) + 1,
        level: options.mode === 'strict' ? 'error' : 'warning',
        code: err.code === 'TooFewFields' ? 'MISSING_COLUMNS' : 'TRAILING_COLUMNS',
        message: err.message
      });
    }
  }

  const headerFields = parsed.meta.fields?.map(f => f.trim().toLowerCase()) ?? [];
  for (const required of REQUIRED_COLUMNS) {
    if (!headerFields.includes(required)) {
      return emptyResultWithError('MISSING_REQUIRED_COLUMN', `Required column "${required}" is missing from the CSV header.`);
    }
  }

  if (options.mode === 'strict') {
    const unexpected = headerFields.filter(f => !KNOWN_COLUMNS.has(f));
    if (unexpected.length > 0) {
      return emptyResultWithError('UNEXPECTED_COLUMNS_STRICT', `Strict mode rejects unexpected columns: ${unexpected.join(', ')}`);
    }
  }

  const records: IntervalRecordImport[] = [];
  let rejectedRows = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    if (Date.now() - startedAt > options.limits.maxParseDurationMs) {
      warnings.push({ code: 'PARSE_TIMEOUT', message: `Parsing aborted after exceeding ${options.limits.maxParseDurationMs}ms; only ${records.length} of ${parsed.data.length} rows were processed.` });
      break;
    }

    const rowNumber = i + 1;
    const raw = parsed.data[i];
    const { fields, issues } = validateRowFields(raw, rowNumber, options.mode);

    let timestampIso: string | undefined;
    const rawTimestamp = raw.timestamp;
    if (rawTimestamp === undefined || rawTimestamp.trim() === '') {
      issues.push({ rowNumber, level: 'error', code: 'MISSING_TIMESTAMP', message: 'timestamp is required and missing.' });
    } else {
      const parsedTs = parseTimestamp(rawTimestamp, options.tariffTimezone);
      if (parsedTs.error) {
        issues.push({ rowNumber, level: 'error', code: 'INVALID_TIMESTAMP', message: parsedTs.error, rawValue: rawTimestamp });
      } else {
        timestampIso = parsedTs.iso;
        const dstAnomaly = detectDstAnomaly(rawTimestamp, options.tariffTimezone);
        if (dstAnomaly === 'skipped') {
          issues.push({ rowNumber, level: 'warning', code: 'DST_SKIPPED_TIME', message: `Wall-clock time "${rawTimestamp}" falls in a DST "spring forward" gap and does not exist in ${options.tariffTimezone}; resolved using the post-transition offset.`, rawValue: rawTimestamp });
        } else if (dstAnomaly === 'ambiguous') {
          issues.push({ rowNumber, level: 'warning', code: 'DST_AMBIGUOUS_TIME', message: `Wall-clock time "${rawTimestamp}" is ambiguous (occurs twice) during a DST "fall back" transition in ${options.tariffTimezone}; resolved using the pre-transition offset.`, rawValue: rawTimestamp });
        }
      }
    }

    const hasBlockingError = issues.some(iss => iss.level === 'error');
    rowErrors.push(...issues);

    if (hasBlockingError || timestampIso === undefined || fields.loadKw === undefined) {
      rejectedRows++;
      continue;
    }

    records.push({
      timestamp: timestampIso,
      loadKw: fields.loadKw,
      loadKva: fields.loadKva,
      powerFactor: fields.powerFactor,
      solarKw: fields.solarKw,
      dgKw: fields.dgKw,
      gridAvailable: fields.gridAvailable,
      tariffPeriod: fields.tariffPeriod,
      rowNumber
    });
  }

  // Sort is NOT applied - out-of-order timestamps are reported as errors, not silently
  // fixed, per the requirement not to silently sort rows. Duplicate/order detection
  // below operates on the records in their original file order.
  const { duplicates, outOfOrder } = detectDuplicatesAndOrder(records);
  rowErrors.push(...duplicates, ...outOfOrder);
  const outOfOrderRowNumbers = new Set(outOfOrder.map(e => e.rowNumber));
  const duplicateRowNumbers = new Set(duplicates.map(e => e.rowNumber));

  // Records with duplicate/out-of-order timestamps are excluded from the accepted set
  // (they cannot safely feed a chronological interval simulation) but are retained in
  // rowErrors for visibility.
  const cleanRecords = records.filter(r => !outOfOrderRowNumbers.has(r.rowNumber) && !duplicateRowNumbers.has(r.rowNumber));
  rejectedRows += records.length - cleanRecords.length;

  const cadenceResult = detectCadence(cleanRecords, options.allowIrregular);
  warnings.push(...cadenceResult.warnings);

  const cadenceRejected = !options.allowIrregular && !cadenceResult.isRegular;
  const finalRecords = cadenceRejected ? [] : cleanRecords;
  if (cadenceRejected) rejectedRows += cleanRecords.length;

  const missingIntervalCount = cadenceResult.intervalDurationMinutes
    ? detectMissingIntervals(finalRecords, cadenceResult.intervalDurationMinutes)
    : 0;
  if (missingIntervalCount > 0) {
    warnings.push({ code: 'MISSING_INTERVALS', message: `${missingIntervalCount} expected interval(s) appear to be missing based on the detected cadence.` });
  }

  const errorCount = rowErrors.filter(e => e.level === 'error').length;
  const warningRowCount = rowErrors.filter(e => e.level === 'warning').length;

  const truncatedRowErrors = rowErrors.slice(0, options.limits.maxValidationErrorsReturned);
  if (rowErrors.length > options.limits.maxValidationErrorsReturned) {
    warnings.push({ code: 'ERROR_LIST_TRUNCATED', message: `${rowErrors.length} row issues found; only the first ${options.limits.maxValidationErrorsReturned} are returned.` });
  }

  const summary: ImportSummary = {
    rowCount: parsed.data.length,
    acceptedRows: finalRecords.length,
    rejectedRows,
    warningCount: warningRowCount,
    errorCount,
    duplicateCount: duplicates.length,
    missingIntervalCount,
    intervalDurationMinutes: cadenceResult.intervalDurationMinutes,
    startTimestamp: finalRecords[0]?.timestamp,
    endTimestamp: finalRecords[finalRecords.length - 1]?.timestamp,
    engineeringGrade: cadenceResult.isRegular && !cadenceRejected && errorCount === 0
  };

  return { summary, records: finalRecords, rowErrors: truncatedRowErrors, warnings };
}

function emptyResultWithError(code: string, message: string): ImportResult {
  return {
    summary: {
      rowCount: 0,
      acceptedRows: 0,
      rejectedRows: 0,
      warningCount: 0,
      errorCount: 1,
      duplicateCount: 0,
      missingIntervalCount: 0,
      engineeringGrade: false
    },
    records: [],
    rowErrors: [{ rowNumber: 0, level: 'error', code, message }],
    warnings: []
  };
}
