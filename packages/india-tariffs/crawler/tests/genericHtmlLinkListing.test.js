import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverLinks } from "../src/adapters/genericHtmlLinkListing.js";
function makeSource(overrides = {}) {
    return {
        source_id: "EXAMPLE",
        url: "https://example.gov.in/tariffs",
        source_type: "TARIFF_ORDER",
        authority_rank: 1,
        monitoring_status: "ACTIVE",
        allowed_domains: ["example.gov.in"],
        discovery_method: "HTML_LINKS",
        adapter: "generic_html_link_listing",
        ...overrides,
    };
}
const html = `
<html><body>
  <a href="/orders/tariff-order-2027.pdf">Tariff Order 2027</a>
  <a href="/orders/amendment-2027.pdf">Amendment to Tariff Order</a>
  <a href="/petitions/petition-123.pdf">Petition for Tariff Revision</a>
  <a href="/notices/public-hearing.pdf">Public Hearing Notice</a>
  <a href="https://other.gov.in/tariffs/order.pdf">Cross-domain link</a>
  <a href="/orders/tariff-order-2027.pdf">Duplicate link, same href</a>
</body></html>
`;
test("discoverLinks resolves relative hrefs to absolute URLs", () => {
    const links = discoverLinks(html, "https://example.gov.in/tariffs", makeSource());
    const urls = links.map((l) => l.url);
    assert.ok(urls.includes("https://example.gov.in/orders/tariff-order-2027.pdf"));
});
test("discoverLinks applies include_patterns", () => {
    const source = makeSource({ include_patterns: ["tariff", "amendment"] });
    const links = discoverLinks(html, "https://example.gov.in/tariffs", source);
    const urls = links.map((l) => l.url);
    assert.ok(urls.some((u) => u.includes("tariff-order-2027")));
    assert.ok(urls.some((u) => u.includes("amendment-2027")));
    assert.ok(!urls.some((u) => u.includes("public-hearing")));
});
test("discoverLinks applies exclude_patterns even when include_patterns would match", () => {
    const source = makeSource({ include_patterns: ["tariff"], exclude_patterns: ["petition"] });
    const links = discoverLinks(html, "https://example.gov.in/tariffs", source);
    const urls = links.map((l) => l.url);
    assert.ok(!urls.some((u) => u.includes("petition-123")));
});
test("discoverLinks deduplicates identical hrefs", () => {
    const links = discoverLinks(html, "https://example.gov.in/tariffs", makeSource());
    const matching = links.filter((l) => l.url === "https://example.gov.in/orders/tariff-order-2027.pdf");
    assert.equal(matching.length, 1);
});
//# sourceMappingURL=genericHtmlLinkListing.test.js.map