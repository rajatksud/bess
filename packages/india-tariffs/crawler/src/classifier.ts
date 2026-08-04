export type DocumentClass =
  | "FINAL_TARIFF_ORDER"
  | "TARIFF_SCHEDULE"
  | "MYT_ORDER"
  | "REVIEW_ORDER"
  | "TRUE_UP_NO_RATE_CHANGE"
  | "TRUE_UP_WITH_RATE_CHANGE"
  | "AMENDMENT"
  | "CORRIGENDUM"
  | "FAC_FPPAS_ADJUSTMENT"
  | "DUTY_TAX_CESS_NOTIFICATION"
  | "SUPPLY_CODE_AMENDMENT"
  | "TARIFF_PETITION"
  | "PUBLIC_NOTICE"
  | "IRRELEVANT";
// Matches classification_results.document_class's CHECK constraint in
// 0001_init.sql exactly -- no new migration needed for this classifier.

export interface ClassificationEvidence {
  linkText: string | null;
  url: string;
  /** From PDF metadata or a detected first-page heading, when available. */
  documentTitle: string | null;
  /** First ~2000 characters of extracted text, when available (native text extraction runs before classification in the real pipeline -- see extraction/extractionOrchestrator.ts). */
  firstPageText: string | null;
  issuingAuthority: string | null;
  orderNumber: string | null;
  hasEffectiveDateLanguage: boolean;
  hasFinalOrderSignatureLanguage: boolean;
}

export interface ClassificationOutcome {
  documentClass: DocumentClass;
  confidence: number;
  evidence: Record<string, unknown>;
}

export const CLASSIFIER_VERSION = "india-tariffs-classifier/0.2.0";

const EFFECTIVE_DATE_PATTERN = /effective from|with effect from|shall come into (force|effect)|w\.e\.f\.?/i;
const FINAL_ORDER_SIGNATURE_PATTERN = /hereby (order|approve|determine)|in exercise of powers|ordered accordingly/i;

/**
 * Builds ClassificationEvidence's two boolean flags from raw text -- kept as
 * a standalone export so callers assembling evidence from PDF text don't
 * duplicate this regex logic.
 */
export function detectEffectiveDateLanguage(text: string): boolean {
  return EFFECTIVE_DATE_PATTERN.test(text);
}

export function detectFinalOrderSignatureLanguage(text: string): boolean {
  return FINAL_ORDER_SIGNATURE_PATTERN.test(text);
}

/**
 * Rule-based, evidence-weighted classifier (crawler architecture section 9;
 * strategy doc section 8.2). Replaces the prior stub, which defaulted to
 * the source's declared source_type for any non-HTML response -- an
 * optimistic default that could let a petition or draft masquerade as a
 * tariff-bearing class. This version never defaults optimistically: an
 * unmatched document falls to IRRELEVANT at low confidence rather than
 * inheriting the source's type.
 *
 * Petition/public-notice signals are checked FIRST and short-circuit --
 * this is the mechanism that guarantees a document mentioning "petition" or
 * "public notice" can never be classified into a tariff-bearing class
 * regardless of what other final-order-shaped language it also contains
 * (crawler architecture: "Petitions and public notices must never generate
 * publishable candidates").
 */
export function classifyDocument(evidence: ClassificationEvidence): ClassificationOutcome {
  const haystack = [evidence.linkText, evidence.url, evidence.documentTitle, evidence.firstPageText]
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .toLowerCase();

  const matched: string[] = [];
  const record = (signal: string) => matched.push(signal);

  if (/\bpetition\b/.test(haystack)) {
    return {
      documentClass: "TARIFF_PETITION",
      confidence: 0.75,
      evidence: { matchedSignals: ["petition"], haystackSample: haystack.slice(0, 300) },
    };
  }
  if (/public notice|notice inviting|invites (objections|comments)/.test(haystack)) {
    return {
      documentClass: "PUBLIC_NOTICE",
      confidence: 0.7,
      evidence: { matchedSignals: ["public-notice"], haystackSample: haystack.slice(0, 300) },
    };
  }
  if (/\bhearing\b/.test(haystack) && !/final order|hereby order/.test(haystack)) {
    return {
      documentClass: "PUBLIC_NOTICE",
      confidence: 0.55,
      evidence: { matchedSignals: ["hearing-without-final-order-language"], haystackSample: haystack.slice(0, 300) },
    };
  }

  if (/corrigendum/.test(haystack)) {
    record("corrigendum");
    return { documentClass: "CORRIGENDUM", confidence: 0.8, evidence: { matchedSignals: matched } };
  }

  if (/\bfac\b|fppas|fuel.{0,10}power purchase (cost )?adjustment/.test(haystack)) {
    record("fac-fppas");
    return { documentClass: "FAC_FPPAS_ADJUSTMENT", confidence: 0.75, evidence: { matchedSignals: matched } };
  }

  if (/duty|\bcess\b|electricity tax/.test(haystack) && /notification|notified/.test(haystack)) {
    record("duty-tax-cess-notification");
    return { documentClass: "DUTY_TAX_CESS_NOTIFICATION", confidence: 0.65, evidence: { matchedSignals: matched } };
  }

  if (/supply code/.test(haystack) && /amendment/.test(haystack)) {
    record("supply-code-amendment");
    return { documentClass: "SUPPLY_CODE_AMENDMENT", confidence: 0.7, evidence: { matchedSignals: matched } };
  }

  if (/multi.{0,3}year tariff|\bmyt\b/.test(haystack)) {
    record("myt");
    return { documentClass: "MYT_ORDER", confidence: 0.75, evidence: { matchedSignals: matched } };
  }

  if (/true.?up/.test(haystack)) {
    record("true-up");
    const rateChangeLanguage = /revised rate|rate change|tariff schedule (attached|enclosed)|revision in (tariff|rate)/.test(haystack);
    return {
      documentClass: rateChangeLanguage ? "TRUE_UP_WITH_RATE_CHANGE" : "TRUE_UP_NO_RATE_CHANGE",
      confidence: 0.7,
      evidence: { matchedSignals: [...matched, rateChangeLanguage ? "rate-change-language" : "no-rate-change-language"] },
    };
  }

  if (/review (order|petition)/.test(haystack) && !/\bpetition\b/.test(haystack)) {
    record("review-order");
    return { documentClass: "REVIEW_ORDER", confidence: 0.65, evidence: { matchedSignals: matched } };
  }

  if (/amendment/.test(haystack)) {
    record("amendment");
    return { documentClass: "AMENDMENT", confidence: 0.65, evidence: { matchedSignals: matched } };
  }

  // Final tariff order requires BOTH signature language AND effective-date
  // language -- either alone is not sufficient evidence (a petition can
  // also mention an intended effective date; a general order can mention
  // "hereby directs" without being a tariff order specifically).
  const hasSignature = evidence.hasFinalOrderSignatureLanguage || FINAL_ORDER_SIGNATURE_PATTERN.test(haystack);
  const hasEffectiveDate = evidence.hasEffectiveDateLanguage || EFFECTIVE_DATE_PATTERN.test(haystack);
  if (hasSignature && hasEffectiveDate) {
    record("final-order-signature-language");
    record("effective-date-language");
    return { documentClass: "FINAL_TARIFF_ORDER", confidence: 0.8, evidence: { matchedSignals: matched } };
  }

  if (/tariff (schedule|order)|retail supply tariff|rate chart/.test(haystack)) {
    record("tariff-schedule-shaped");
    return { documentClass: "TARIFF_SCHEDULE", confidence: 0.5, evidence: { matchedSignals: matched } };
  }

  // No signal matched with reasonable confidence -- fall back to IRRELEVANT
  // rather than defaulting to whatever the source's own declared type is
  // (the prior stub's behavior). Evidence records which signals were
  // checked and found absent, for auditability.
  return {
    documentClass: "IRRELEVANT",
    confidence: 0.2,
    evidence: {
      matchedSignals: [],
      checkedSignals: [
        "petition",
        "public-notice",
        "hearing",
        "corrigendum",
        "fac-fppas",
        "duty-tax-cess",
        "supply-code-amendment",
        "myt",
        "true-up",
        "review-order",
        "amendment",
        "final-order-signature+effective-date",
        "tariff-schedule-shaped",
      ],
      haystackSample: haystack.slice(0, 300),
    },
  };
}
