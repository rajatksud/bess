import { describe, it, expect } from 'vitest';
import { importIntervalCsv } from '../csvImporter';

function makeFlatCsv(rows: number, startIso = '2024-06-15T00:00:00Z', stepMinutes = 15): string {
  const header = 'timestamp,load_kw,solar_kw';
  const lines = [header];
  const startMs = Date.parse(startIso);
  for (let i = 0; i < rows; i++) {
    const t = new Date(startMs + i * stepMinutes * 60000).toISOString();
    lines.push(`${t},${100 + i},10`);
  }
  return lines.join('\n');
}

describe('valid interval data', () => {
  it('parses a valid 15-minute CSV', () => {
    const csv = makeFlatCsv(10, '2024-06-15T00:00:00Z', 15);
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(10);
    expect(result.summary.errorCount).toBe(0);
    expect(result.summary.intervalDurationMinutes).toBe(15);
    expect(result.summary.engineeringGrade).toBe(true);
  });

  it('parses a valid 30-minute CSV', () => {
    const csv = makeFlatCsv(8, '2024-06-15T00:00:00Z', 30);
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(8);
    expect(result.summary.intervalDurationMinutes).toBe(30);
  });

  it('parses a valid hourly CSV', () => {
    const csv = makeFlatCsv(24, '2024-06-15T00:00:00Z', 60);
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(24);
    expect(result.summary.intervalDurationMinutes).toBe(60);
  });

  it('computes peak load, total energy and solar contribution from accepted rows', () => {
    // 10 rows of loadKw 100..109 at 15-min cadence, flat solarKw=10.
    const csv = makeFlatCsv(10, '2024-06-15T00:00:00Z', 15);
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });

    expect(result.summary.peakLoadKw).toBe(109);
    expect(result.summary.totalLoadEnergyKwh).toBeCloseTo(1045 * 0.25, 5);
    expect(result.summary.totalSolarEnergyKwh).toBeCloseTo(10 * 10 * 0.25, 5);
    expect(result.summary.solarContributionPct).toBeCloseTo(9.6, 1);
  });

  it('leaves energy/peak summary fields undefined when there are no accepted rows', () => {
    const result = importIntervalCsv('timestamp,load_kw\n', { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(0);
    expect(result.summary.peakLoadKw).toBeUndefined();
    expect(result.summary.totalLoadEnergyKwh).toBeUndefined();
    expect(result.summary.solarContributionPct).toBeUndefined();
  });
});

describe('CSV format edge cases', () => {
  it('handles a UTF-8 BOM at the start of the file', () => {
    const csv = '﻿' + makeFlatCsv(4);
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(4);
    expect(result.summary.errorCount).toBe(0);
  });

  it('handles quoted values with embedded commas', () => {
    const csv = 'timestamp,load_kw,tariff_period\n2024-06-15T00:00:00Z,100,"Peak, Surge"\n2024-06-15T00:15:00Z,110,"Off-Peak, Discount"';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(2);
    expect(result.records[0].tariffPeriod).toBe('Peak, Surge');
  });

  it('skips blank lines', () => {
    const csv = 'timestamp,load_kw\n2024-06-15T00:00:00Z,100\n\n2024-06-15T00:15:00Z,110\n';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(2);
  });

  it('handles CRLF line endings', () => {
    const csv = 'timestamp,load_kw\r\n2024-06-15T00:00:00Z,100\r\n2024-06-15T00:15:00Z,110\r\n';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.acceptedRows).toBe(2);
  });
});

describe('duplicate and out-of-order timestamps', () => {
  it('flags a duplicate timestamp as an error and excludes it from accepted rows', () => {
    const csv = 'timestamp,load_kw\n2024-06-15T00:00:00Z,100\n2024-06-15T00:00:00Z,110\n2024-06-15T00:15:00Z,120';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.duplicateCount).toBe(1);
    expect(result.rowErrors.some(e => e.code === 'DUPLICATE_TIMESTAMP')).toBe(true);
  });

  it('flags an out-of-order timestamp as an error and does not silently sort', () => {
    const csv = 'timestamp,load_kw\n2024-06-15T00:15:00Z,100\n2024-06-15T00:00:00Z,110\n2024-06-15T00:30:00Z,120';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.rowErrors.some(e => e.code === 'OUT_OF_ORDER_TIMESTAMP')).toBe(true);
    // The out-of-order row is excluded, not silently reordered.
    expect(result.records.map(r => r.timestamp)).not.toContain('2024-06-15T00:00:00.000Z');
  });
});

describe('missing intervals', () => {
  it('detects a gap in an otherwise-regular 15-minute cadence', () => {
    // Three consecutive 15-min gaps (0:00-0:45) establish the cadence as 15 minutes,
    // then a single 30-min gap (0:45-1:15) registers as exactly one missing interval.
    const csv = 'timestamp,load_kw\n' +
      '2024-06-15T00:00:00Z,100\n' +
      '2024-06-15T00:15:00Z,105\n' +
      '2024-06-15T00:30:00Z,110\n' +
      '2024-06-15T00:45:00Z,115\n' +
      '2024-06-15T01:15:00Z,120';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.summary.intervalDurationMinutes).toBe(15);
    expect(result.summary.missingIntervalCount).toBe(1);
  });
});

describe('mixed cadence', () => {
  // A 20-minute gap between 15-minute intervals is genuinely irregular - it is NOT a
  // clean multiple of the 15-minute cadence, so it cannot be explained as a "missing
  // interval" and must be treated as mixed/irregular cadence.
  it('rejects mixed cadence by default', () => {
    const csv = 'timestamp,load_kw\n2024-06-15T00:00:00Z,100\n2024-06-15T00:15:00Z,110\n2024-06-15T00:35:00Z,120';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC', allowIrregular: false });
    expect(result.summary.acceptedRows).toBe(0);
    expect(result.summary.engineeringGrade).toBe(false);
    expect(result.warnings.some(w => w.code === 'MIXED_CADENCE_REJECTED')).toBe(true);
  });

  it('accepts mixed cadence when allowIrregular=true, but marks it non-engineering-grade', () => {
    const csv = 'timestamp,load_kw\n2024-06-15T00:00:00Z,100\n2024-06-15T00:15:00Z,110\n2024-06-15T00:35:00Z,120';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC', allowIrregular: true });
    expect(result.summary.acceptedRows).toBe(3);
    expect(result.summary.engineeringGrade).toBe(false);
    expect(result.warnings.some(w => w.code === 'MIXED_CADENCE_ACCEPTED')).toBe(true);
  });
});

describe('row-level validation', () => {
  it('flags an invalid (non-numeric) load value', () => {
    const csv = 'timestamp,load_kw\n2024-06-15T00:00:00Z,abc';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.rowErrors.some(e => e.code === 'INVALID_LOAD')).toBe(true);
    expect(result.summary.acceptedRows).toBe(0);
  });

  it('flags a negative load value', () => {
    const csv = 'timestamp,load_kw\n2024-06-15T00:00:00Z,-50';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.rowErrors.some(e => e.code === 'NEGATIVE_LOAD')).toBe(true);
  });

  it('flags an invalid power factor value in permissive mode as a warning, keeping the row', () => {
    const csv = 'timestamp,load_kw,power_factor\n2024-06-15T00:00:00Z,100,1.5';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC', mode: 'permissive' });
    expect(result.rowErrors.some(e => e.code === 'INVALID_PF' && e.level === 'warning')).toBe(true);
    expect(result.summary.acceptedRows).toBe(1);
  });

  it('flags kVA below kW beyond tolerance', () => {
    const csv = 'timestamp,load_kw,load_kva\n2024-06-15T00:00:00Z,100,80';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.rowErrors.some(e => e.code === 'KVA_BELOW_KW')).toBe(true);
  });

  it('rejects a missing required timestamp', () => {
    const csv = 'timestamp,load_kw\n,100';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.rowErrors.some(e => e.code === 'MISSING_TIMESTAMP')).toBe(true);
    expect(result.summary.acceptedRows).toBe(0);
  });

  it('rejects an invalid (non-ISO) timestamp', () => {
    const csv = 'timestamp,load_kw\n15/06/2024 10:00,100';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC' });
    expect(result.rowErrors.some(e => e.code === 'INVALID_TIMESTAMP')).toBe(true);
  });
});

describe('DST transitions', () => {
  it('flags a skipped wall-clock time during a spring-forward transition (America/New_York, 2024-03-10 02:30 does not exist)', () => {
    const csv = 'timestamp,load_kw\n2024-03-10T02:30:00,100';
    const result = importIntervalCsv(csv, { tariffTimezone: 'America/New_York' });
    expect(result.rowErrors.some(e => e.code === 'DST_SKIPPED_TIME')).toBe(true);
  });

  it('flags an ambiguous wall-clock time during a fall-back transition (America/New_York, 2024-11-03 01:30 occurs twice)', () => {
    const csv = 'timestamp,load_kw\n2024-11-03T01:30:00,100';
    const result = importIntervalCsv(csv, { tariffTimezone: 'America/New_York' });
    expect(result.rowErrors.some(e => e.code === 'DST_AMBIGUOUS_TIME')).toBe(true);
  });
});

describe('size and row limits', () => {
  it('rejects a file exceeding the configured maximum size', () => {
    const csv = makeFlatCsv(10);
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC', limits: { maxFileSizeBytes: 10, maxRowCount: 1000, maxParseDurationMs: 5000, maxValidationErrorsReturned: 100 } });
    expect(result.rowErrors.some(e => e.code === 'FILE_TOO_LARGE')).toBe(true);
  });

  it('rejects a file exceeding the configured maximum row count', () => {
    const csv = makeFlatCsv(50);
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC', limits: { maxFileSizeBytes: 10_000_000, maxRowCount: 10, maxParseDurationMs: 5000, maxValidationErrorsReturned: 100 } });
    expect(result.rowErrors.some(e => e.code === 'TOO_MANY_ROWS')).toBe(true);
  });
});

describe('strict vs permissive unexpected columns', () => {
  it('rejects an unexpected column in strict mode', () => {
    const csv = 'timestamp,load_kw,mystery_column\n2024-06-15T00:00:00Z,100,xyz';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC', mode: 'strict' });
    expect(result.rowErrors.some(e => e.code === 'UNEXPECTED_COLUMNS_STRICT')).toBe(true);
  });

  it('ignores an unexpected column in permissive mode without rejecting the file', () => {
    const csv = 'timestamp,load_kw,mystery_column\n2024-06-15T00:00:00Z,100,xyz';
    const result = importIntervalCsv(csv, { tariffTimezone: 'UTC', mode: 'permissive' });
    expect(result.summary.acceptedRows).toBe(1);
  });
});
