// CSV interval-data ingestion and validation — core types.

export interface ImportLimits {
  maxFileSizeBytes: number;
  maxRowCount: number;
  maxParseDurationMs: number;
  maxValidationErrorsReturned: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxRowCount: 200_000,
  maxParseDurationMs: 30_000,
  maxValidationErrorsReturned: 500
};

export interface ColumnMapping {
  timestamp: string;
  loadKw: string;
  loadKva?: string;
  powerFactor?: string;
  solarKw?: string;
  dgKw?: string;
  gridAvailable?: string;
  tariffPeriod?: string;
}

export const DEFAULT_COLUMN_MAPPING: ColumnMapping = {
  timestamp: 'timestamp',
  loadKw: 'load_kw',
  loadKva: 'load_kva',
  powerFactor: 'power_factor',
  solarKw: 'solar_kw',
  dgKw: 'dg_kw',
  gridAvailable: 'grid_available',
  tariffPeriod: 'tariff_period'
};

export interface ImportOptions {
  columnMapping: ColumnMapping;
  limits: ImportLimits;
  /** Strict mode rejects unexpected columns and any row-level validation error. Permissive mode collects warnings and keeps otherwise-valid rows. */
  mode: 'strict' | 'permissive';
  /** IANA timezone used to resolve timestamps with no explicit UTC offset. Required — must come from the tariff, not guessed. */
  tariffTimezone: string;
  /** When true, mixed/irregular cadence is accepted and the result is marked non-engineering-grade instead of rejected. */
  allowIrregular: boolean;
}

export interface IntervalRecordImport {
  timestamp: string; // ISO 8601, resolved to an absolute instant
  loadKw: number;
  loadKva?: number;
  powerFactor?: number;
  solarKw?: number;
  dgKw?: number;
  gridAvailable?: boolean;
  tariffPeriod?: string;
  rowNumber: number; // 1-indexed, header excluded
}

export type RowIssueLevel = 'error' | 'warning';

export interface RowError {
  rowNumber: number;
  level: RowIssueLevel;
  code: string;
  message: string;
  rawValue?: string;
}

export interface ImportWarning {
  code: string;
  message: string;
}

export interface ImportSummary {
  rowCount: number;
  acceptedRows: number;
  rejectedRows: number;
  warningCount: number;
  errorCount: number;
  duplicateCount: number;
  missingIntervalCount: number;
  intervalDurationMinutes?: number;
  startTimestamp?: string;
  endTimestamp?: string;
  engineeringGrade: boolean;
}

export interface ImportResult {
  summary: ImportSummary;
  records: IntervalRecordImport[];
  rowErrors: RowError[];
  warnings: ImportWarning[];
}
