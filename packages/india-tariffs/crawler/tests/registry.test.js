import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourceRegistry, selectActiveSources } from "../src/registry.js";
function writeRegistry(yaml) {
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-registry-"));
    const path = join(dir, "sources.yaml");
    writeFileSync(path, yaml, "utf8");
    return path;
}
test("loadSourceRegistry accepts a well-formed source", () => {
    const path = writeRegistry(`
schema_version: "1.0.0"
sources:
  - source_id: EXAMPLE
    url: "https://example.gov.in/tariffs"
    source_type: TARIFF_ORDER
    authority_rank: 1
    monitoring_status: ACTIVE
    allowed_domains: ["example.gov.in"]
    discovery_method: HTML_LINKS
    adapter: generic_html_link_listing
`);
    const sources = loadSourceRegistry(path);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].source_id, "EXAMPLE");
    rmSync(path, { force: true });
});
test("loadSourceRegistry rejects a source missing a required field", () => {
    const path = writeRegistry(`
schema_version: "1.0.0"
sources:
  - source_id: BAD
    url: "https://example.gov.in/tariffs"
    source_type: TARIFF_ORDER
    authority_rank: 1
    monitoring_status: ACTIVE
    allowed_domains: ["example.gov.in"]
    discovery_method: HTML_LINKS
`);
    assert.throws(() => loadSourceRegistry(path), /missing required field "adapter"/);
    rmSync(path, { force: true });
});
test("loadSourceRegistry rejects a source whose own url is outside its allowed_domains", () => {
    const path = writeRegistry(`
schema_version: "1.0.0"
sources:
  - source_id: MISMATCHED
    url: "https://other.gov.in/tariffs"
    source_type: TARIFF_ORDER
    authority_rank: 1
    monitoring_status: ACTIVE
    allowed_domains: ["example.gov.in"]
    discovery_method: HTML_LINKS
    adapter: generic_html_link_listing
`);
    assert.throws(() => loadSourceRegistry(path), /is not in its own allowed_domains list/);
    rmSync(path, { force: true });
});
test("selectActiveSources filters by monitoring_status", () => {
    const path = writeRegistry(`
schema_version: "1.0.0"
sources:
  - source_id: ACTIVE-ONE
    url: "https://example.gov.in/a"
    source_type: TARIFF_ORDER
    authority_rank: 1
    monitoring_status: ACTIVE
    allowed_domains: ["example.gov.in"]
    discovery_method: HTML_LINKS
    adapter: generic_html_link_listing
  - source_id: NOT-CONFIGURED-ONE
    url: "https://example.gov.in/b"
    source_type: TARIFF_ORDER
    authority_rank: 1
    monitoring_status: NOT_CONFIGURED
    allowed_domains: ["example.gov.in"]
    discovery_method: HTML_LINKS
    adapter: generic_html_link_listing
`);
    const sources = loadSourceRegistry(path);
    const active = selectActiveSources(sources);
    assert.deepEqual(active.map((s) => s.source_id), ["ACTIVE-ONE"]);
    rmSync(path, { force: true });
});
//# sourceMappingURL=registry.test.js.map