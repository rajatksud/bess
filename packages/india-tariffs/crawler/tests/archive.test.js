import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentArchive } from "../src/archive.js";
function sha256(buf) {
    return createHash("sha256").update(buf).digest("hex");
}
function makeArchive() {
    const dir = mkdtempSync(join(tmpdir(), "india-tariffs-archive-"));
    return {
        archive: new DocumentArchive(join(dir, "blobs"), join(dir, "manifest.json")),
        dir,
    };
}
function record(overrides, body) {
    return {
        requestedUrl: overrides.finalUrl ?? "https://example.gov.in/a.pdf",
        finalUrl: "https://example.gov.in/a.pdf",
        sourceId: "EXAMPLE",
        retrievedAt: new Date().toISOString(),
        httpStatus: 200,
        contentType: "application/pdf",
        contentLength: body.byteLength,
        sha256: sha256(body),
        fetcherVersion: "test",
        parentListingUrl: null,
        ...overrides,
    };
}
test("put() stores a new document and adds it to the manifest", () => {
    const { archive, dir } = makeArchive();
    const body = Buffer.from("tariff order content v1");
    const { entry, isNewDocument } = archive.put(body, record({}, body), "TARIFF_ORDER");
    assert.equal(isNewDocument, true);
    assert.equal(entry.sha256, sha256(body));
    assert.equal(archive.listDocuments().length, 1);
    rmSync(dir, { recursive: true, force: true });
});
test("put() recognizes the same binary observed at a new URL as one document", () => {
    const { archive, dir } = makeArchive();
    const body = Buffer.from("tariff order content v1");
    const first = archive.put(body, record({ finalUrl: "https://example.gov.in/a.pdf" }, body), "TARIFF_ORDER");
    const second = archive.put(body, record({ finalUrl: "https://example.gov.in/mirrors/a-copy.pdf" }, body), "TARIFF_ORDER");
    assert.equal(second.isNewDocument, false);
    assert.equal(second.entry.document_id, first.entry.document_id);
    assert.deepEqual(second.entry.observed_urls.sort(), [
        "https://example.gov.in/a.pdf",
        "https://example.gov.in/mirrors/a-copy.pdf",
    ]);
    assert.equal(archive.listDocuments().length, 1);
    rmSync(dir, { recursive: true, force: true });
});
test("findReplacement detects an unchanged URL now serving new content", () => {
    const { archive, dir } = makeArchive();
    const url = "https://example.gov.in/a.pdf";
    const bodyV1 = Buffer.from("tariff order content v1");
    const bodyV2 = Buffer.from("tariff order content v2, silently swapped");
    archive.put(bodyV1, record({ finalUrl: url }, bodyV1), "TARIFF_ORDER");
    const replacement = archive.findReplacement(url, sha256(bodyV2));
    assert.ok(replacement, "expected a replacement to be detected");
    assert.equal(replacement?.sha256, sha256(bodyV1));
    const noReplacement = archive.findReplacement(url, sha256(bodyV1));
    assert.equal(noReplacement, null);
    rmSync(dir, { recursive: true, force: true });
});
//# sourceMappingURL=archive.test.js.map