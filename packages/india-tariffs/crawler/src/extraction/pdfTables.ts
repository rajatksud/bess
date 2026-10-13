import type { PositionedTextItem } from "./pdfText.js";

export interface ExtractedTable {
  pageNumber: number;
  rows: string[][];
  extractionMethod: "TABLE_EXTRACTION";
}

const ROW_Y_TOLERANCE = 3; // px; items within this y-distance are treated as the same row
const MIN_COLUMNS_FOR_TABLE = 2;
const MIN_ROWS_FOR_TABLE = 2;

/**
 * Best-effort layout-based table reconstruction from pdfjs-dist's
 * positioned text items: clusters items into rows by y-coordinate proximity,
 * then into columns by x-coordinate ordering within each row. Deliberately
 * not a dedicated table-extraction library (e.g. a Python/JVM-bridge tool) --
 * those don't fit the node:24-alpine Docker target, and this is explicitly
 * a best-effort requirement ("table extraction where feasible"), not a hard
 * correctness bar. Returns [] rather than throwing when no table-like
 * structure is detected on a page.
 */
export function reconstructTables(page: { pageNumber: number; items: PositionedTextItem[] }): ExtractedTable[] {
  if (page.items.length === 0) return [];

  const sorted = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PositionedTextItem[][] = [];

  for (const item of sorted) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0].y - item.y) <= ROW_Y_TOLERANCE) {
      lastRow.push(item);
    } else {
      rows.push([item]);
    }
  }

  // A "table-like" region is a contiguous run of rows that each have at
  // least MIN_COLUMNS_FOR_TABLE distinct x-positioned items (i.e. more than
  // one column of content, not a single wrapped line of prose).
  const candidateRows = rows.filter((row) => row.length >= MIN_COLUMNS_FOR_TABLE);
  if (candidateRows.length < MIN_ROWS_FOR_TABLE) return [];

  const tableRows: string[][] = candidateRows.map((row) =>
    [...row].sort((a, b) => a.x - b.x).map((item) => item.str.trim()),
  );

  return [{ pageNumber: page.pageNumber, rows: tableRows, extractionMethod: "TABLE_EXTRACTION" }];
}
