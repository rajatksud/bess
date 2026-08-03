import { RowError } from './types';
import { neutraliseForSpreadsheet } from './rowValidation';

/** Renders row errors/warnings as a downloadable CSV, with spreadsheet-formula-injection neutralised in text cells. */
export function renderRowErrorsCsv(rowErrors: RowError[]): string {
  const header = 'row_number,level,code,message,raw_value';
  const lines = rowErrors.map(e => {
    const cells = [
      String(e.rowNumber),
      e.level,
      e.code,
      csvEscape(neutraliseForSpreadsheet(e.message)),
      csvEscape(neutraliseForSpreadsheet(e.rawValue ?? ''))
    ];
    return cells.join(',');
  });
  return [header, ...lines].join('\n');
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
