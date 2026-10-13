import { load as loadHtml } from "cheerio";
import type { AuthoritativeSource, DiscoveredLink } from "../types.js";

/**
 * Generic HTML-link discovery adapter (crawler architecture section 5.1).
 * Parses an anchor-tag listing page and returns candidate document links
 * filtered by the source's include/exclude patterns. This only inspects
 * hrefs and link text — it never executes page scripts (section 8).
 */
export function discoverLinks(html: string, listingUrl: string, source: AuthoritativeSource): DiscoveredLink[] {
  const $ = loadHtml(html);
  const candidates: DiscoveredLink[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, listingUrl).toString();
    } catch {
      return; // unparsable href, skip
    }

    const linkText = $(el).text().trim();
    if (matchesFilters(absoluteUrl, linkText, source)) {
      candidates.push({ url: absoluteUrl, linkText, listingUrl });
    }
  });

  return dedupeByUrl(candidates);
}

function matchesFilters(url: string, linkText: string, source: AuthoritativeSource): boolean {
  const haystack = `${url} ${linkText}`.toLowerCase();

  const include = source.include_patterns ?? [];
  if (include.length > 0 && !include.some((p) => haystack.includes(p.toLowerCase()))) {
    return false;
  }

  const exclude = source.exclude_patterns ?? [];
  if (exclude.some((p) => haystack.includes(p.toLowerCase()))) {
    return false;
  }

  return true;
}

function dedupeByUrl(links: DiscoveredLink[]): DiscoveredLink[] {
  const seen = new Map<string, DiscoveredLink>();
  for (const link of links) {
    if (!seen.has(link.url)) {
      seen.set(link.url, link);
    }
  }
  return [...seen.values()];
}
