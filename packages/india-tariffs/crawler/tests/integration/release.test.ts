import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CrawlerDatabase } from "../../src/db/client.js";
import { loadTestDatabaseConfig } from "../../src/db/env.js";
import { migrate } from "../../src/db/migrate.js";
import { compileRelease } from "../../src/release/compileRelease.js";

/**
 * compileRelease() reads approved_tariffs directly (it is the one file
 * exempted by tests/noAutoApproval.test.ts's ALLOWED_APPROVAL_READER_FILES,
 * since it runs strictly after a human review decision). This test seeds
 * that human-approved state by hand -- exactly as a real reviewer's
 * review-decision workflow would produce it -- then verifies the compiled
 * release only reflects what was actually approved, is byte-for-byte
 * reproducible (same sha256) across two runs of the same approved state, and
 * correctly excludes superseded approvals.
 */

function tryLoadConfig() {
  try {
    return loadTestDatabaseConfig();
  } catch {
    return null;
  }
}

const config = tryLoadConfig();

interface SeededCandidate {
  candidateId: number;
  jurisdictionCode: string;
  licenseeCode: string;
  categoryCode: string;
}

async function seedApprovedCandidate(
  db: CrawlerDatabase,
  overrides: { jurisdictionCode?: string; licenseeCode?: string; categoryCode?: string; effectiveFrom?: string } = {},
): Promise<SeededCandidate> {
  const jurisdictionCode = overrides.jurisdictionCode ?? "ZZ";
  const licenseeCode = overrides.licenseeCode ?? `TESTLIC-${randomUUID().slice(0, 8)}`;
  const categoryCode = overrides.categoryCode ?? "HT-2A";
  const effectiveFrom = overrides.effectiveFrom ?? "2026-04-01";
  const sourceId = `TEST-SRC-${randomUUID()}`;
  const documentId = `TEST-DOC-${randomUUID()}`;

  return db.withClient(async (client) => {
    await client.query(
      `INSERT INTO jurisdictions (code, name, jurisdiction_type, coverage_status)
       VALUES ($1, 'Test Jurisdiction', 'STATE', 'NOT_STARTED') ON CONFLICT (code) DO NOTHING`,
      [jurisdictionCode],
    );
    await client.query(
      `INSERT INTO regulators (code, legal_name, regulator_type)
       VALUES ('ZZREG', 'Test Regulator', 'SERC') ON CONFLICT (code) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO licensees (code, legal_name, jurisdiction_code, regulator_code, licensee_type)
       VALUES ($1, 'Test Licensee', $2, 'ZZREG', 'STATE_UTILITY') ON CONFLICT (code) DO NOTHING`,
      [licenseeCode, jurisdictionCode],
    );
    await client.query(
      `INSERT INTO authoritative_sources (
         source_id, jurisdiction_code, regulator_code, url, allowed_domains, source_type, authority_rank,
         discovery_method, adapter, monitoring_status
       ) VALUES ($1, $2, 'ZZREG', 'https://example.gov.in/tariffs', ARRAY['example.gov.in'], 'TARIFF_ORDER', 1,
                 'HTML_LINKS', 'generic_html_link_listing', 'ACTIVE')`,
      [sourceId, jurisdictionCode],
    );
    await client.query(
      `INSERT INTO source_documents (document_id, source_id, sha256, storage_uri, document_type, first_seen_at, last_observed_at)
       VALUES ($1, $2, $3, '/tmp/fake.pdf', 'TARIFF_ORDER', now(), now())`,
      [documentId, sourceId, randomUUID().replace(/-/g, "").padEnd(64, "0")],
    );
    const { rows: jobRows } = await client.query<{ id: string }>(
      `INSERT INTO extraction_jobs (document_id, status, method) VALUES ($1, 'SUCCEEDED', 'NATIVE_TEXT') RETURNING id`,
      [documentId],
    );
    const { rows: attemptRows } = await client.query<{ id: string }>(
      `INSERT INTO extraction_attempts (extraction_job_id, attempt_number, status, extractor_version)
       VALUES ($1, 1, 'SUCCEEDED', 'test') RETURNING id`,
      [jobRows[0].id],
    );

    const { rows: candidateRows } = await client.query<{ id: string }>(
      `INSERT INTO candidate_tariffs (
         extraction_attempt_id, document_id, jurisdiction_code, licensee_code, category_code,
         category_name_original, consumer_class, supply_level, billing_energy_basis, billing_demand_basis,
         order_date, effective_from, retrieved_at, status
       ) VALUES ($1, $2, $3, $4, $5, 'HT Industrial', 'INDUSTRIAL', 'HT', 'KVAH', 'KVA', '2026-03-27', $6, now(), 'REVIEW_READY')
       RETURNING id`,
      [attemptRows[0].id, documentId, jurisdictionCode, licenseeCode, categoryCode, effectiveFrom],
    );
    const candidateId = Number(candidateRows[0].id);

    await client.query(
      `INSERT INTO candidate_charge_components (candidate_tariff_id, charge_id, charge_type, value, currency, unit, behaviour)
       VALUES ($1, 'ENERGY_STANDARD', 'ENERGY', '7.25', 'INR', 'INR_PER_KVAH', 'ADDITIVE'),
              ($1, 'DEMAND_STANDARD', 'DEMAND', '350.00', 'INR', 'INR_PER_KVA_MONTH', 'ADDITIVE')`,
      [candidateId],
    );

    const { rows: reviewRows } = await client.query<{ id: string }>(
      `INSERT INTO review_decisions (candidate_tariff_id, decision, reviewer) VALUES ($1, 'APPROVED', 'test-reviewer') RETURNING id`,
      [candidateId],
    );
    await client.query(
      `INSERT INTO approved_tariffs (candidate_tariff_id, review_decision_id, confidence_grade, effective_from)
       VALUES ($1, $2, 'A', $3)`,
      [candidateId, reviewRows[0].id, effectiveFrom],
    );

    return { candidateId, jurisdictionCode, licenseeCode, categoryCode };
  });
}

test("compileRelease includes only currently-effective approved tariffs, with charges and a stable sha256", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const seeded = await seedApprovedCandidate(db);

    const release = await compileRelease(db, `test-${randomUUID()}`);

    const compiled = release.tariffs.find((t) => t.licenseeCode === seeded.licenseeCode);
    assert.ok(compiled, "expected the seeded approved tariff to appear in the compiled release");
    assert.equal(compiled?.categoryCode, seeded.categoryCode);
    assert.equal(compiled?.confidenceGrade, "A");
    assert.equal(compiled?.charges.length, 2);
    assert.ok(compiled?.charges.some((c) => c.type === "ENERGY" && c.value === "7.2500"));

    assert.equal(release.manifest.dataset, "india-tariffs");
    assert.ok(release.manifest.jurisdictionsCovered.includes(seeded.jurisdictionCode));
    assert.equal(release.manifest.tariffCount, release.tariffs.length);
    assert.match(release.manifest.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await db.close();
  }
});

test("compileRelease excludes an approval that has been superseded", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    const licenseeCode = `TESTLIC-${randomUUID().slice(0, 8)}`;
    const first = await seedApprovedCandidate(db, { licenseeCode, effectiveFrom: "2025-04-01" });
    const second = await seedApprovedCandidate(db, { licenseeCode, categoryCode: first.categoryCode, effectiveFrom: "2026-04-01" });

    await db.withClient((client) =>
      client.query(
        `UPDATE approved_tariffs SET superseded_by_tariff_id = (SELECT id FROM approved_tariffs WHERE candidate_tariff_id = $1)
         WHERE candidate_tariff_id = $2`,
        [second.candidateId, first.candidateId],
      ),
    );

    const release = await compileRelease(db, `test-${randomUUID()}`);
    const matches = release.tariffs.filter((t) => t.licenseeCode === licenseeCode);
    assert.equal(matches.length, 1, "only the non-superseded approval should appear in the release");
    assert.equal(matches[0].effectiveFrom, "2026-04-01");
  } finally {
    await db.close();
  }
});

test("compileRelease produces an identical sha256 for an unchanged approved data set across two compilations", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    await seedApprovedCandidate(db);

    const first = await compileRelease(db, `test-a-${randomUUID()}`);
    const second = await compileRelease(db, `test-b-${randomUUID()}`);

    assert.equal(first.manifest.sha256, second.manifest.sha256, "identical approved data must hash identically regardless of release version label");
  } finally {
    await db.close();
  }
});

test("compileRelease links a new release's supersededRelease to the immediately prior release version", { skip: !config }, async () => {
  const db = new CrawlerDatabase(config!);
  try {
    await db.ensureEnvironmentMarker();
    await migrate(db);
    await seedApprovedCandidate(db);

    const versionA = `test-chain-a-${randomUUID()}`;
    const versionB = `test-chain-b-${randomUUID()}`;
    await compileRelease(db, versionA);
    const releaseB = await compileRelease(db, versionB);

    assert.equal(releaseB.manifest.supersededRelease, versionA);
  } finally {
    await db.close();
  }
});
