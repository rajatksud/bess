import { apiRequest } from './client';
import { DatasetImportResult } from './types';

export interface ImportDatasetInput {
  projectId: string;
  csvText: string;
  tariffTimezone: string;
  mode?: 'strict' | 'permissive';
  allowIrregular?: boolean;
  sourceFile?: string;
}

/** Posts raw CSV text to the server, which runs it through the existing src/import pipeline (unchanged) and persists an IntervalDataset + IntervalRecord rows. */
export function importDataset(input: ImportDatasetInput): Promise<DatasetImportResult> {
  return apiRequest<DatasetImportResult>('/datasets/import', { method: 'POST', body: input });
}
