import { resolve } from "node:path";
import { DocumentArchive } from "./archive.js";
import { crawlSource } from "./crawl.js";
import { FETCHER_VERSION } from "./fetcher.js";
import { loadSourceRegistry, selectActiveSources } from "./registry.js";
import { CrawlerDatabase } from "./db/client.js";
import { loadDatabaseConfig } from "./db/env.js";
import { migrate, currentMigrationVersion } from "./db/migrate.js";
import { loadRegistryIntoDatabase } from "./db/registryLoader.js";
import { startCrawlRun, finishCrawlRun } from "./db/crawlRunRepository.js";
import { HttpAcquisitionProvider } from "./acquisition/httpProvider.js";
import { FirecrawlAcquisitionProvider } from "./acquisition/firecrawlProvider.js";
import { AutoAcquisitionProvider } from "./acquisition/autoProvider.js";
import type { AcquisitionProvider } from "./acquisition/types.js";
import { runExtraction } from "./extraction/extractionOrchestrator.js";
import type { SourceDocumentRow } from "./extraction/extractionOrchestrator.js";
import { runValidation } from "./validation/runValidation.js";
import { runSchedulerBatch } from "./scheduler.js";
import { generateReviewReport } from "./review/reviewReport.js";
import { writeFileSync } from "node:fs";

// In local development, import.meta.dirname is
// packages/india-tariffs/crawler/dist/src at runtime, three levels above
// packages/india-tariffs. In the deployed container image (see Dockerfile),
// dist/src instead sits directly under /app, alongside /app/registry and
// /app/schemas copied from the same build context -- a different depth, so
// CRAWLER_PACKAGE_ROOT lets deployment pin the correct root explicitly
// rather than inferring it from directory depth.
const PACKAGE_ROOT = process.env.CRAWLER_PACKAGE_ROOT
  ? resolve(process.env.CRAWLER_PACKAGE_ROOT)
  : resolve(import.meta.dirname, "..", "..", "..");
const DEFAULT_REGISTRY_PATH = resolve(PACKAGE_ROOT, "registry", "sources.yaml");
// CRAWLER_ARCHIVE_DIR overrides the archive location (set to a mounted
// volume path in the deployed container, see Dockerfile); defaults to the
// package-relative path for local development.
const ARCHIVE_DIR = process.env.CRAWLER_ARCHIVE_DIR
  ? resolve(process.env.CRAWLER_ARCHIVE_DIR)
  : resolve(PACKAGE_ROOT, "crawler", ".archive");
const DEFAULT_ARCHIVE_DIR = ARCHIVE_DIR;
const DEFAULT_REGISTRY_DIR = resolve(PACKAGE_ROOT, "registry");

const USAGE =
  "Usage: cli.js <crawl|verify|migrate|registry-load|source-health|extract|validate|schedule-run|review-report> " +
  "[--registry <path>] [--source <source_id>] [--document <document_id>] [--candidate <id>] " +
  "[--out <path>] [--production]";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command === "--help" || command === "-h" || command === undefined) {
    console.log(USAGE);
    return;
  }
  if (command === "crawl") {
    await runCrawl(args);
    return;
  }
  if (command === "verify") {
    runVerify(args);
    return;
  }
  if (command === "migrate") {
    await runMigrate(args);
    return;
  }
  if (command === "registry-load") {
    await runRegistryLoad(args);
    return;
  }
  if (command === "source-health") {
    await runSourceHealth(args);
    return;
  }
  if (command === "extract") {
    await runExtract(args);
    return;
  }
  if (command === "validate") {
    await runValidateCommand(args);
    return;
  }
  if (command === "schedule-run") {
    await runScheduleRun(args);
    return;
  }
  if (command === "review-report") {
    await runReviewReport(args);
    return;
  }

  console.error(USAGE);
  process.exitCode = 1;
}

function targetFromEnv(): "staging" | "production" {
  const appEnv = process.env.APP_ENV;
  if (appEnv === "production") return "production";
  if (appEnv === "staging") return "staging";
  throw new Error(`APP_ENV must be "staging" or "production" for database commands, got "${appEnv ?? "<unset>"}"`);
}

async function runMigrate(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const allowProduction = args.includes("--production");
  if (target === "production" && !allowProduction) {
    console.error('Refusing to migrate a production-configured environment without --production.');
    process.exitCode = 1;
    return;
  }

  const db = new CrawlerDatabase(loadDatabaseConfig(target, "admin"));
  try {
    const before = await currentMigrationVersion(db).catch(() => null);
    const result = await migrate(db, { allowProduction });
    const after = await currentMigrationVersion(db);
    console.log(`Migration target: ${target}`);
    console.log(`Schema version before: ${before ?? "(none)"}`);
    console.log(`Applied: ${result.applied.length > 0 ? result.applied.join(", ") : "(none, already current)"}`);
    console.log(`Already current: ${result.alreadyCurrent.length}`);
    console.log(`Schema version after: ${after ?? "(none)"}`);
  } finally {
    await db.close();
  }
}

async function runRegistryLoad(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const registryDir = flagValue(args, "--registry-dir") ?? DEFAULT_REGISTRY_DIR;

  const db = new CrawlerDatabase(loadDatabaseConfig(target));
  try {
    const result = await loadRegistryIntoDatabase(db, {
      jurisdictions: resolve(registryDir, "jurisdictions.yaml"),
      regulators: resolve(registryDir, "regulators.yaml"),
      licensees: resolve(registryDir, "licensees.yaml"),
      sources: resolve(registryDir, "sources.yaml"),
      sharedTariffGroups: resolve(registryDir, "shared_tariff_groups.yaml"),
      reviewQueue: resolve(registryDir, "licensee_review_queue.yaml"),
    });
    console.log(`Registry loaded into ${target}:`);
    console.log(`  jurisdictions: ${result.jurisdictions}`);
    console.log(`  regulators: ${result.regulators} (${result.regulatorJurisdictionLinks} jurisdiction links)`);
    console.log(`  licensees: ${result.licensees}`);
    console.log(`  sources: ${result.sources}`);
    console.log(`  shared tariff groups: ${result.sharedTariffGroups}`);
    console.log(`  review queue entries: ${result.reviewQueueEntries}`);
  } finally {
    await db.close();
  }
}

async function runSourceHealth(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const db = new CrawlerDatabase(loadDatabaseConfig(target));
  try {
    await db.verifyEnvironmentMarker();
    const summary = await db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT monitoring_status, count(*) FROM authoritative_sources GROUP BY monitoring_status ORDER BY 1`,
      );
      return rows;
    });
    console.log(`Source health summary (${target}):`);
    for (const row of summary) {
      console.log(`  ${row.monitoring_status}: ${row.count}`);
    }
  } finally {
    await db.close();
  }
}

/**
 * Builds the acquisition provider for the crawl command. Firecrawl is only
 * constructed when FIRECRAWL_BASE_URL is set (deployment status is
 * discovered from the environment, not assumed) -- AUTO mode then behaves
 * as HTTP-only when Firecrawl was never deployed or the 90-minute
 * deployment timebox was exhausted, per the mission's own fallback
 * instructions (see acquisition/autoProvider.ts).
 */
function buildAcquisitionProvider(): AcquisitionProvider {
  const http = new HttpAcquisitionProvider();
  const firecrawlBaseUrl = process.env.FIRECRAWL_BASE_URL;
  const firecrawl = firecrawlBaseUrl
    ? new FirecrawlAcquisitionProvider({
        baseUrl: firecrawlBaseUrl,
        apiKey: process.env.FIRECRAWL_API_KEY || null,
        timeoutMs: Number(process.env.FIRECRAWL_TIMEOUT_MS ?? "30000"),
      })
    : null;
  return new AutoAcquisitionProvider({ http, firecrawl });
}

async function runCrawl(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const registryPath = flagValue(args, "--registry") ?? DEFAULT_REGISTRY_PATH;
  const onlySourceId = flagValue(args, "--source");

  const sources = loadSourceRegistry(registryPath);
  const active = selectActiveSources(sources).filter((s) => !onlySourceId || s.source_id === onlySourceId);

  if (active.length === 0) {
    console.log("No ACTIVE sources matched. Sources start as NOT_CONFIGURED until verified — see registry/sources.yaml.");
    return;
  }

  const db = new CrawlerDatabase(loadDatabaseConfig(target));
  await db.verifyEnvironmentMarker();

  const archive = new DocumentArchive(DEFAULT_ARCHIVE_DIR, db);
  const acquisition = buildAcquisitionProvider();
  let hadErrors = false;

  try {
    for (const source of active) {
      console.log(`\n[${source.source_id}] crawling ${source.url}`);
      const run = await startCrawlRun(db, source.source_id, FETCHER_VERSION);
      const result = await crawlSource(source, archive, db, run.id, acquisition);

      const status: "SUCCEEDED" | "FAILED" | "PARTIAL" =
        result.errors.length === 0 ? "SUCCEEDED" : result.documentsFetched > 0 ? "PARTIAL" : "FAILED";
      await finishCrawlRun(db, run.id, {
        status,
        linksDiscovered: result.linksDiscovered,
        documentsFetched: result.documentsFetched,
        newDocuments: result.newDocuments,
        replacementsDetected: result.replacementsDetected.length,
        errorSummary: result.errors.length > 0 ? result.errors.join("; ") : null,
      });

      console.log(
        `[${source.source_id}] run #${run.id} status=${status} links=${result.linksDiscovered} fetched=${result.documentsFetched} new=${result.newDocuments}`,
      );
      if (result.replacementsDetected.length > 0) {
        console.warn(`[${source.source_id}] REPLACEMENT DETECTED:\n  ${result.replacementsDetected.join("\n  ")}`);
      }
      if (result.errors.length > 0) {
        hadErrors = true;
        console.error(`[${source.source_id}] errors:\n  ${result.errors.join("\n  ")}`);
      }
    }
  } finally {
    await db.close();
  }

  if (hadErrors) {
    process.exitCode = 1;
  }
}

/**
 * Runs classification + (conditionally) extraction for one already-archived
 * document. Deliberately single-document, not a batch loop over every
 * source_documents row -- batching extraction is future scheduler work (see
 * scheduler.ts), and forcing --document here keeps this command's blast
 * radius obvious when run by hand against staging.
 */
async function runExtract(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const documentId = flagValue(args, "--document");
  if (!documentId) {
    console.error("extract requires --document <document_id>");
    process.exitCode = 1;
    return;
  }

  const db = new CrawlerDatabase(loadDatabaseConfig(target));
  await db.verifyEnvironmentMarker();

  try {
    const { rows } = await db.withClient((client) =>
      client.query(
        `SELECT sd.document_id, sd.source_id, sd.storage_uri, sd.content_type, sd.first_seen_at,
                s.source_id AS s_source_id, s.jurisdiction_code, s.regulator_code, s.licensee_code, s.url,
                s.source_type, s.authority_rank, s.monitoring_status, s.allowed_domains, s.discovery_method, s.adapter
         FROM source_documents sd
         JOIN authoritative_sources s ON s.source_id = sd.source_id
         WHERE sd.document_id = $1`,
        [documentId],
      ),
    );
    if (rows.length === 0) {
      console.error(`No source_documents row found for document_id=${documentId}`);
      process.exitCode = 1;
      return;
    }
    const row = rows[0];
    const document: SourceDocumentRow = {
      document_id: row.document_id,
      source_id: row.source_id,
      storage_uri: row.storage_uri,
      content_type: row.content_type,
      first_seen_at: row.first_seen_at.toISOString(),
    };
    const source = {
      source_id: row.s_source_id,
      jurisdiction_code: row.jurisdiction_code ?? undefined,
      regulator_code: row.regulator_code ?? undefined,
      licensee_code: row.licensee_code ?? undefined,
      url: row.url,
      source_type: row.source_type,
      authority_rank: row.authority_rank,
      monitoring_status: row.monitoring_status,
      allowed_domains: row.allowed_domains,
      discovery_method: row.discovery_method,
      adapter: row.adapter,
    };

    const result = await runExtraction(db, document, source);
    console.log(`[${documentId}] classification=${result.classification.documentClass} confidence=${result.classification.confidence}`);
    console.log(`[${documentId}] status=${result.status}${result.reason ? ` (${result.reason})` : ""}`);
    if (result.candidateTariffIds.length > 0) {
      console.log(`[${documentId}] candidate_tariffs created: ${result.candidateTariffIds.join(", ")}`);
    }
  } finally {
    await db.close();
  }
}

/**
 * Runs validation for either one candidate_tariffs row (--candidate) or
 * every candidate produced from one document (--document) -- the latter is
 * the common case right after an `extract` run, so the operator doesn't have
 * to enumerate ids by hand.
 */
async function runValidateCommand(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const candidateArg = flagValue(args, "--candidate");
  const documentArg = flagValue(args, "--document");
  if (!candidateArg && !documentArg) {
    console.error("validate requires --candidate <id> or --document <document_id>");
    process.exitCode = 1;
    return;
  }

  const db = new CrawlerDatabase(loadDatabaseConfig(target));
  await db.verifyEnvironmentMarker();

  try {
    let candidateIds: number[];
    if (candidateArg) {
      candidateIds = [Number(candidateArg)];
    } else {
      const { rows } = await db.withClient((client) =>
        client.query<{ id: string }>(`SELECT id FROM candidate_tariffs WHERE document_id = $1 ORDER BY id`, [documentArg]),
      );
      candidateIds = rows.map((r) => Number(r.id));
    }

    let reviewReadyCount = 0;
    for (const candidateId of candidateIds) {
      const result = await runValidation(db, candidateId);
      const errorCount = result.findings.filter((f) => f.severity === "ERROR").length;
      const warningCount = result.findings.filter((f) => f.severity === "WARNING").length;
      console.log(
        `[candidate ${candidateId}] reviewReady=${result.reviewReady} errors=${errorCount} warnings=${warningCount} info=${result.findings.length - errorCount - warningCount}`,
      );
      if (result.reviewReady) reviewReadyCount++;
    }
    console.log(`\n${reviewReadyCount}/${candidateIds.length} candidate(s) reached REVIEW_READY`);
  } finally {
    await db.close();
  }
}

/**
 * Generates a human-readable Markdown report of extracted tariff candidates
 * for external review, without requiring anyone to write SQL against the
 * staging database directly. Prints to stdout by default so it can be piped
 * (`| less`, `> report.md`), or written straight to a file with --out.
 */
async function runReviewReport(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const documentId = flagValue(args, "--document");
  const candidateArg = flagValue(args, "--candidate");
  const outPath = flagValue(args, "--out");

  const db = new CrawlerDatabase(loadDatabaseConfig(target));
  await db.verifyEnvironmentMarker();

  try {
    const report = await generateReviewReport(db, {
      documentId,
      candidateId: candidateArg ? Number(candidateArg) : undefined,
    });
    if (outPath) {
      writeFileSync(outPath, report, "utf8");
      console.log(`Review report written to ${outPath}`);
    } else {
      console.log(report);
    }
  } finally {
    await db.close();
  }
}

/**
 * Runs one scheduler pass: crawls every ACTIVE source whose crawl_schedules
 * row is due, one at a time, each behind its own named advisory lock so
 * multiple concurrently-running scheduler containers never double-crawl a
 * source. Emits one structured JSON-line log per batch and exits nonzero if
 * any source failed, so a cron/systemd-timer invocation surfaces failures in
 * its own exit-code-based alerting without needing to parse the log itself.
 */
async function runScheduleRun(args: string[]): Promise<void> {
  const target = targetFromEnv();
  const registryPath = flagValue(args, "--registry") ?? DEFAULT_REGISTRY_PATH;
  const registry = loadSourceRegistry(registryPath);

  const db = new CrawlerDatabase(loadDatabaseConfig(target));
  await db.verifyEnvironmentMarker();

  const archive = new DocumentArchive(DEFAULT_ARCHIVE_DIR, db);
  const acquisition = buildAcquisitionProvider();
  const schedulerInstanceId = process.env.SCHEDULER_INSTANCE_ID || `scheduler-${process.pid}-${Date.now()}`;

  try {
    const result = await runSchedulerBatch({ db, registry, archive, acquisition, schedulerInstanceId });
    console.log(JSON.stringify({ event: "scheduler_batch_complete", schedulerInstanceId, ...result }));
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

function runVerify(args: string[]): void {
  const registryPath = flagValue(args, "--registry") ?? DEFAULT_REGISTRY_PATH;
  const sources = loadSourceRegistry(registryPath);
  console.log(`Registry OK: ${sources.length} source(s) at ${registryPath}`);
  for (const s of sources) {
    console.log(`  - ${s.source_id} [${s.monitoring_status}] adapter=${s.adapter} domains=${s.allowed_domains.join(",")}`);
  }
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
