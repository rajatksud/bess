import type { NativeTextExtractionResult } from "./pdfText.js";
import type { ExtractedTable } from "./pdfTables.js";
import type { AuthoritativeSource } from "../types.js";

export const FIELD_EXTRACTOR_VERSION = "india-tariffs-fieldextractor/0.1.0";

export type ConsumerClass = "INDUSTRIAL" | "COMMERCIAL" | "MIXED" | "OTHER";
export type SupplyLevel = "LT" | "HT" | "EHT";
export type BillingEnergyBasis = "KWH" | "KVAH";
export type BillingDemandBasis = "KW" | "KVA" | "HP" | "NONE";

export interface FieldCitation {
  pageNumber: number;
  extractedText: string;
}

export interface ExtractedChargeComponent {
  chargeType:
    | "FIXED"
    | "DEMAND"
    | "ENERGY"
    | "TOD_SURCHARGE"
    | "TOD_REBATE"
    | "FAC_FPPAS"
    | "POWER_FACTOR_PENALTY"
    | "POWER_FACTOR_INCENTIVE"
    | "LOAD_FACTOR_INCENTIVE"
    | "REACTIVE_ENERGY"
    | "DUTY"
    | "TAX"
    | "CESS"
    | "MINIMUM_CHARGE"
    | "REBATE"
    | "OTHER";
  /** Decimal string per the mission's "never binary float for money" requirement. May be a signed delta (e.g. "-0.30") when only a year-on-year change, not an absolute rate, could be confidently located -- see valueIsDelta. */
  value: string;
  valueIsDelta: boolean;
  unit: string;
  behaviour: "ADDITIVE" | "MULTIPLICATIVE" | "REBATE";
  citation: FieldCitation;
}

export interface ExtractedTariffFields {
  categoryCode: string | null;
  categoryNameOriginal: string;
  consumerClass: ConsumerClass | null;
  supplyLevel: SupplyLevel | null;
  billingEnergyBasis: BillingEnergyBasis | null;
  billingDemandBasis: BillingDemandBasis | null;
  orderNumber: string | null;
  orderDate: string | null;
  effectiveFrom: string | null;
  charges: ExtractedChargeComponent[];
  /** Fields that could not be established reliably from this document; each entry becomes a validation WARNING rather than being silently omitted. Per the mission: never fabricate a value merely to fill a field. */
  unresolvedFields: string[];
  categoryCitation: FieldCitation | null;
}

// Matches only the category header ("(N) CODE Name:"), not the decision
// text that follows -- the decision text for category N is taken as
// everything between this header and the *next* header (or end of page),
// found via a second pass. PDF text extraction joins wrapped lines with
// spaces rather than newlines, so a single non-greedy regex spanning both
// the header and its decision text cannot reliably find the right
// boundary; slicing between consecutive header positions is exact instead
// of heuristic.
const CATEGORY_HEADER_PATTERN = /\((\d+)\)\s*((?:HT|LT)-\d+[a-z]?(?:\([a-z]+\))?(?:\([iv]+\))?)\s+([^:]+?):/gi;

const ENERGY_CHARGE_DELTA_PATTERN =
  /(reduction|increase|decrease) in energy charges by\s*(\d+(?:\.\d+)?)-?paise(?:\s*,\s*(\d+(?:\.\d+)?)-?paise)?(?:\s*,?\s*and\s*(\d+(?:\.\d+)?)-?paise)?\s*per unit/i;

const FIXED_CHARGE_DELTA_PATTERN =
  /increase in fixed charges by\s*Rs\.?\s*(\d+(?:\.\d+)?)\/(kVA|kW)/i;

const ORDER_DATE_PATTERN = /(\d{1,2})\s*(?:ST|ND|RD|TH)?\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER),?\s+(\d{4})/i;

const EFFECTIVE_FROM_METER_READING_PATTERN =
  /effective from the 1st meter reading date falling on or after 1st (\w+),?\s*(\d{4})/i;

const MONTH_TO_NUM: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/**
 * Locates the order's own signature date (the printed date on the cover
 * page, e.g. "27TH MARCH, 2025") by scanning only the first few pages --
 * later pages routinely contain many other unrelated dates (hearing dates,
 * historical order dates cited in the narrative), so restricting the scan
 * avoids picking up the wrong one.
 */
function findOrderDate(pages: NativeTextExtractionResult["pages"]): { date: string; citation: FieldCitation } | null {
  for (const page of pages.slice(0, 5)) {
    const match = ORDER_DATE_PATTERN.exec(page.text);
    if (match) {
      const [, day, monthName, year] = match;
      const month = MONTH_TO_NUM[monthName.toLowerCase()];
      if (!month) continue;
      const iso = `${year}-${month}-${day.padStart(2, "0")}`;
      return { date: iso, citation: { pageNumber: page.pageNumber, extractedText: match[0] } };
    }
  }
  return null;
}

/**
 * Locates an "effective from the 1st meter reading date falling on or
 * after 1st <Month>, <Year>" clause -- the specific effective-date
 * mechanism this KERC order (and similarly structured orders) uses,
 * distinct from a plain calendar effective date. Scans per-page (rather
 * than the joined fullText) so the match can be attributed to a real page
 * number for citation purposes.
 */
function findEffectiveFromOnPages(
  pages: NativeTextExtractionResult["pages"],
): { date: string; citation: FieldCitation } | null {
  for (const page of pages) {
    const match = EFFECTIVE_FROM_METER_READING_PATTERN.exec(page.text);
    if (match) {
      const [, monthName, year] = match;
      const month = MONTH_TO_NUM[monthName.toLowerCase()];
      if (!month) continue;
      return {
        date: `${year}-${month}-01`,
        citation: { pageNumber: page.pageNumber, extractedText: match[0] },
      };
    }
  }
  return null;
}

function classifyCategoryName(name: string): ConsumerClass {
  const lower = name.toLowerCase();
  if (/industrial/.test(lower)) return "INDUSTRIAL";
  if (/commercial/.test(lower)) return "COMMERCIAL";
  if (/educational|hospital|residential|apartment|colon(y|ies)|lift irrigation|water supply|horticultur|nurser|temporary|lighting/.test(lower)) return "OTHER";
  return "MIXED";
}

function supplyLevelFromCode(code: string): SupplyLevel {
  if (code.startsWith("HT")) return "HT";
  if (code.startsWith("LT")) return "LT";
  return "HT"; // EHT categories, if present, are not distinguished by this simple prefix check; conservative default
}

/**
 * Narrow, evidence-tuned regex extraction against the real document(s)
 * fetched in Phase 5 -- deliberately NOT a general-purpose tariff-document
 * parser. This targets the specific narrative structure KERC's Combined
 * Tariff Order 2025 uses (a numbered "(N) CATEGORY-CODE Name: <decision
 * text>" list under section 6.7-6.8), which is a real, common pattern
 * across Indian SERC tariff orders (year-on-year delta language rather
 * than a single flat rate table for every category). Any field that
 * cannot be established with reasonable confidence from the actual text is
 * left null/omitted from charges and recorded in unresolvedFields --
 * never guessed to satisfy a completion count.
 */
export function extractTariffFields(
  nativeText: NativeTextExtractionResult,
  _tables: ExtractedTable[],
  source: AuthoritativeSource,
): ExtractedTariffFields[] {
  const orderDateResult = findOrderDate(nativeText.pages);
  const effectiveFromResult = findEffectiveFromOnPages(nativeText.pages);

  const results: ExtractedTariffFields[] = [];

  for (const page of nativeText.pages) {
    // Pass 1: find every category-header position on this page.
    CATEGORY_HEADER_PATTERN.lastIndex = 0;
    const headers: { index: number; headerEnd: number; categoryCode: string; categoryName: string }[] = [];
    let headerMatch: RegExpExecArray | null;
    while ((headerMatch = CATEGORY_HEADER_PATTERN.exec(page.text)) !== null) {
      headers.push({
        index: headerMatch.index,
        headerEnd: headerMatch.index + headerMatch[0].length,
        categoryCode: headerMatch[2],
        categoryName: headerMatch[3].trim(),
      });
    }

    // Pass 2: each category's decision text is everything between its own
    // header and the next header (or end of page) -- an exact boundary,
    // not a regex heuristic, so it can't bleed into the following
    // category's text the way a single greedy/non-greedy pattern did.
    for (let i = 0; i < headers.length; i++) {
      const { categoryCode, categoryName, headerEnd } = headers[i];
      const sliceEnd = i + 1 < headers.length ? headers[i + 1].index : page.text.length;
      const decisionText = page.text.slice(headerEnd, sliceEnd).trim();
      const unresolvedFields: string[] = [];
      const charges: ExtractedChargeComponent[] = [];

      const citation: FieldCitation = {
        pageNumber: page.pageNumber,
        extractedText: `(${categoryCode}) ${categoryName}: ${decisionText}`.slice(0, 500),
      };

      const energyMatch = ENERGY_CHARGE_DELTA_PATTERN.exec(decisionText);
      if (energyMatch) {
        const [, direction, firstDelta] = energyMatch;
        const sign = /reduction|decrease/i.test(direction) ? "-" : "+";
        charges.push({
          chargeType: "ENERGY",
          value: `${sign}${(Number(firstDelta) / 100).toFixed(2)}`,
          valueIsDelta: true,
          unit: "INR_PER_KWH",
          behaviour: sign === "-" ? "REBATE" : "ADDITIVE",
          citation,
        });
      } else if (!/no change/i.test(decisionText)) {
        unresolvedFields.push(`${categoryCode}.energyCharge`);
      }

      const fixedMatch = FIXED_CHARGE_DELTA_PATTERN.exec(decisionText);
      if (fixedMatch) {
        const [, deltaAmount, deltaUnit] = fixedMatch;
        charges.push({
          chargeType: "DEMAND",
          value: `+${deltaAmount}`,
          valueIsDelta: true,
          unit: deltaUnit.toUpperCase() === "KVA" ? "INR_PER_KVA_MONTH" : "INR_PER_KW_MONTH",
          behaviour: "ADDITIVE",
          citation,
        });
      } else if (!/no change/i.test(decisionText)) {
        unresolvedFields.push(`${categoryCode}.fixedCharge`);
      }

      if (/no change/i.test(decisionText) && charges.length === 0) {
        // Explicitly "no change" is itself a resolved fact, not an
        // unresolved field -- record it as a zero-value informational
        // charge entry so downstream consumers can distinguish
        // "confirmed no change" from "could not determine".
        charges.push({
          chargeType: "OTHER",
          value: "0",
          valueIsDelta: true,
          unit: "PERCENT_OF_ENERGY_CHARGE",
          behaviour: "ADDITIVE",
          citation,
        });
      }

      unresolvedFields.push(`${categoryCode}.absoluteBaseRate`); // the narrative gives deltas, not absolute Rs./unit or Rs./kVA figures -- see module docstring

      results.push({
        categoryCode,
        categoryNameOriginal: categoryName.trim(),
        consumerClass: classifyCategoryName(categoryName),
        supplyLevel: supplyLevelFromCode(categoryCode),
        billingEnergyBasis: null, // not determinable from this narrative section alone
        billingDemandBasis: supplyLevelFromCode(categoryCode) === "LT" ? null : "KVA",
        orderNumber: null, // no single canonical "Order No. X" header found in this document -- see module notes
        orderDate: orderDateResult?.date ?? null,
        effectiveFrom: effectiveFromResult?.date ?? null,
        charges,
        unresolvedFields: [
          ...unresolvedFields,
          ...(orderDateResult ? [] : ["orderDate"]),
          ...(effectiveFromResult ? [] : ["effectiveFrom"]),
          "orderNumber",
          "billingEnergyBasis",
        ],
        categoryCitation: citation,
      });
    }
  }

  if (results.length === 0) {
    // Nothing matched the expected category-list pattern at all -- this is
    // itself important signal (either the document doesn't use this
    // narrative structure, or extraction genuinely failed to find it), not
    // silently swallowed.
    return [
      {
        categoryCode: null,
        categoryNameOriginal: `(unresolved: no category-level tariff decisions found in ${source.source_id})`,
        consumerClass: null,
        supplyLevel: null,
        billingEnergyBasis: null,
        billingDemandBasis: null,
        orderNumber: null,
        orderDate: orderDateResult?.date ?? null,
        effectiveFrom: effectiveFromResult?.date ?? null,
        charges: [],
        unresolvedFields: ["categoryCode", "charges", "orderNumber"],
        categoryCitation: null,
      },
    ];
  }

  return results;
}
