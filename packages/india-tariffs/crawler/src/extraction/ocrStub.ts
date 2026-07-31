export interface OcrProvider {
  ocrPage(pageImage: Buffer): Promise<{ text: string; confidence: number }>;
}

/**
 * No real OCR engine is wired in this milestone -- deliberately out of
 * scope for the vertical-slice budget. This interface exists so
 * extractionOrchestrator.ts has a real integration seam: a scanned/
 * image-only PDF (extractNativeText throwing ExtractionUnresolvedError)
 * deterministically produces a MANUAL extraction_jobs row rather than
 * crashing or, worse, silently fabricating text to satisfy a completion
 * count.
 */
export class UnimplementedOcrProvider implements OcrProvider {
  async ocrPage(): Promise<{ text: string; confidence: number }> {
    throw new Error("OCR is not implemented in this milestone -- scanned PDFs route to a MANUAL extraction_jobs row instead");
  }
}
