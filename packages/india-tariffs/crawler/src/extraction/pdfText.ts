import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  items: PositionedTextItem[];
}

export interface NativeTextExtractionResult {
  pages: ExtractedPage[];
  fullText: string;
  method: "NATIVE_TEXT";
  extractorVersion: string;
}

export const PDF_TEXT_EXTRACTOR_VERSION = "india-tariffs-pdftext/pdfjs-dist";

/**
 * Thrown when a PDF has no meaningfully extractable text layer -- i.e. it is
 * image-only/scanned. Callers should route to a MANUAL/OCR extraction path
 * (see extraction/ocrStub.ts and extractionOrchestrator.ts) rather than
 * treating this as a hard failure.
 */
export class ExtractionUnresolvedError extends Error {}

const MIN_TOTAL_CHARS_FOR_RESOLVED_TEXT = 200;
const NUL_CHAR_REGEX = new RegExp(String.fromCharCode(0), "g");

/**
 * Strips NUL characters (code point 0) from extracted text. Postgres TEXT
 * columns reject embedded NULs, and some PDF extractors occasionally emit
 * stray NULs for malformed glyph data. This must only ever be applied to
 * the *derivative* text used for citations/candidate fields -- the
 * archived original PDF bytes (see archive.ts) are never touched by this
 * or any other sanitizer.
 */
export function sanitizeExtractedText(text: string): string {
  return text.replace(NUL_CHAR_REGEX, "");
}

/**
 * Extracts embedded text per-page from a PDF buffer using pdfjs-dist
 * (chosen over pdf-parse/pdf-lib: pure-JS with no native build step,
 * critical for the node:24-alpine Docker target; per-page positional text
 * output needed for real page-number citations, which a single-
 * concatenated-string extractor cannot give reliably; same engine Firefox
 * ships, giving it the broadest real-world PDF-compatibility testing of any
 * JS-only option).
 *
 * Throws ExtractionUnresolvedError if the total extracted text across all
 * pages is below a minimal threshold, which is the signature of an
 * image-only/scanned PDF with no embedded text layer.
 */
export async function extractNativeText(pdfBuffer: Buffer): Promise<NativeTextExtractionResult> {
  let doc;
  try {
    doc = await getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
  } catch (err) {
    throw new ExtractionUnresolvedError(`PDF could not be parsed: ${(err as Error).message}`);
  }

  const pages: ExtractedPage[] = [];
  let totalChars = 0;

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const items: PositionedTextItem[] = content.items
      .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item)
      .map((item) => ({
        str: sanitizeExtractedText(item.str),
        // pdfjs-dist's text-item transform is [scaleX, skewX, skewY, scaleY, x, y]
        // with y measured from the page bottom; flip to a top-down y for
        // more intuitive row-clustering in pdfTables.ts.
        x: item.transform[4],
        y: viewport.height - item.transform[5],
        width: item.width,
        height: item.height,
      }));

    const text = sanitizeExtractedText(items.map((i) => i.str).join(" "));
    totalChars += text.trim().length;
    pages.push({ pageNumber, text, items });
  }

  if (totalChars < MIN_TOTAL_CHARS_FOR_RESOLVED_TEXT) {
    throw new ExtractionUnresolvedError(
      `PDF has only ${totalChars} extractable characters across ${doc.numPages} pages -- likely image-only/scanned, no native text layer`,
    );
  }

  return {
    pages,
    fullText: pages.map((p) => p.text).join("\n"),
    method: "NATIVE_TEXT",
    extractorVersion: PDF_TEXT_EXTRACTOR_VERSION,
  };
}
