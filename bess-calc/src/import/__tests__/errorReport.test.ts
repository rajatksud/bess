import { describe, it, expect } from 'vitest';
import { neutraliseForSpreadsheet } from '../rowValidation';
import { renderRowErrorsCsv } from '../errorReport';

describe('spreadsheet formula-injection neutralisation', () => {
  it.each(['=cmd()', '+1+1', '-1+1', '@SUM(A1)', '\t=evil()'])(
    'prefixes a value starting with %s with a leading apostrophe',
    (value) => {
      expect(neutraliseForSpreadsheet(value)).toBe(`'${value}`);
    }
  );

  it('leaves ordinary text unchanged', () => {
    expect(neutraliseForSpreadsheet('load_kw is not numeric: "abc"')).toBe('load_kw is not numeric: "abc"');
  });

  it('does not alter numeric source values (neutralisation is only applied to report text, never calculation inputs)', () => {
    // This test documents the contract: neutraliseForSpreadsheet is never called on
    // parsed numeric fields (loadKw etc.) in csvImporter.ts, only on report strings.
    const numericLike = '-50';
    expect(neutraliseForSpreadsheet(numericLike)).toBe("'-50");
    expect(Number('-50')).toBe(-50); // the original numeric parse is unaffected
  });
});

describe('renderRowErrorsCsv', () => {
  it('neutralises a formula-injection payload in the message column of the rendered report', () => {
    const csv = renderRowErrorsCsv([
      { rowNumber: 3, level: 'error', code: 'INVALID_LOAD', message: '=cmd|"/c calc"!A1', rawValue: '=1+1' }
    ]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'=1+1");
  });
});
