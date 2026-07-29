import type { AuthoritativeSource, DocumentType } from "./types.js";

/**
 * Minimal document classifier stub (crawler architecture section 9).
 *
 * This intentionally does NOT attempt to distinguish final orders from
 * petitions, amendments, or true-ups — that requires text/title analysis
 * that belongs in a later extraction milestone. For now every discovered
 * document is classified as the source's declared source_type, which is
 * always a conservative (non-publishable-without-review) starting point.
 * Nothing produced here may be treated as an approved tariff record
 * (strategy doc section 8, "DISCOVERED" is the first lifecycle state).
 */
export function classifyDocument(source: AuthoritativeSource, contentType: string | null): DocumentType {
  if (contentType?.includes("text/html")) {
    // An HTML hit against a document-oriented source is very likely a listing
    // page fragment or index, not the document itself.
    return "SECONDARY_SUMMARY";
  }
  return source.source_type;
}
