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
  "Usage: cli.js <crawl|verify|migrate|registry-load|source-health> " +
  "[--registry <path>] [--source <source_id>] [--production]";

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
