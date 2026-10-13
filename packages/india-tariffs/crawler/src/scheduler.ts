import type { CrawlerDatabase } from "./db/client.js";
import type { AuthoritativeSource } from "./types.js";
import type { DocumentArchive } from "./archive.js";
import type { AcquisitionProvider } from "./acquisition/types.js";
import { crawlSource } from "./crawl.js";
import { startCrawlRun, finishCrawlRun } from "./db/crawlRunRepository.js";
import { FETCHER_VERSION } from "./fetcher.js";

export type Cadence = "HOURLY" | "EVERY_6_HOURS" | "DAILY" | "WEEKLY";

const CADENCE_MS: Record<Cadence, number> = {
  HOURLY: 60 * 60 * 1000,
  EVERY_6_HOURS: 6 * 60 * 60 * 1000,
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
};

/** Pure function: the next scheduled run time for a given cadence, from a given instant. */
export function computeNextRunAt(cadence: Cadence, from: Date): Date {
  return new Date(from.getTime() + CADENCE_MS[cadence]);
}

/** Consecutive failures at or beyond this count stop a source from being scheduled until a human intervenes (registry monitoring_status change) -- prevents an unattended scheduler from hammering a source that is reliably broken. */
const MAX_CONSECUTIVE_FAILURES_BEFORE_SKIP = 5;
const SCHEDULER_LOCK_TTL_SECONDS = 60 * 30;
const MAX_LOCK_JITTER_MS = 5_000;

export interface SchedulerBatchOptions {
  db: CrawlerDatabase;
  registry: AuthoritativeSource[];
  archive: DocumentArchive;
  acquisition: AcquisitionProvider;
  now?: Date;
  jitterMaxMs?: number;
  schedulerInstanceId: string;
}

export interface SchedulerBatchResult {
  attempted: number;
  succeeded: number;
  partial: number;
  failed: number;
  skippedLocked: number;
  skippedNotDue: number;
  skippedTooManyFailures: number;
}

/**
 * Runs one due-check-and-crawl pass over the registry, one source at a time
 * (deliberately sequential, not a worker pool -- consistent with the
 * conservative concurrency stance used throughout this codebase, and it
 * means a single misbehaving source can never starve others of CPU/network
 * concurrency it doesn't actually need). Each source acquires its own named
 * scheduler lock before crawling, so multiple scheduler processes/containers
 * can run this function concurrently against the same database without two
 * of them ever crawling the same source at the same time.
 */
export async function runSchedulerBatch(options: SchedulerBatchOptions): Promise<SchedulerBatchResult> {
  const { db, registry, archive, acquisition, schedulerInstanceId } = options;
  const now = options.now ?? new Date();
  const jitterMaxMs = options.jitterMaxMs ?? MAX_LOCK_JITTER_MS;

  const result: SchedulerBatchResult = {
    attempted: 0,
    succeeded: 0,
    partial: 0,
    failed: 0,
    skippedLocked: 0,
    skippedNotDue: 0,
    skippedTooManyFailures: 0,
  };

  const dueSources = await selectDueSources(db, registry, now);

  for (const source of dueSources) {
    if (jitterMaxMs > 0) {
      await sleep(Math.floor(Math.random() * jitterMaxMs));
    }

    const lockName = `crawl:${source.source_id}`;
    const acquired = await db.tryAcquireSchedulerLock(lockName, schedulerInstanceId, SCHEDULER_LOCK_TTL_SECONDS);
    if (!acquired) {
      result.skippedLocked++;
      continue;
    }

    try {
      const { rows } = await db.withClient((client) =>
        client.query<{ consecutive_failures: number }>(`SELECT consecutive_failures FROM crawl_schedules WHERE source_id = $1`, [
          source.source_id,
        ]),
      );
      const consecutiveFailures = rows[0]?.consecutive_failures ?? 0;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_SKIP) {
        result.skippedTooManyFailures++;
        continue;
      }

      result.attempted++;
      const outcome = await crawlOneSource(db, source, archive, acquisition);
      await recordScheduleOutcome(db, source.source_id, outcome.status, now);

      if (outcome.status === "SUCCEEDED") result.succeeded++;
      else if (outcome.status === "PARTIAL") result.partial++;
      else result.failed++;
    } finally {
      await db.releaseSchedulerLock(lockName, schedulerInstanceId);
    }
  }

  result.skippedNotDue = registry.length - dueSources.length;
  return result;
}

async function selectDueSources(db: CrawlerDatabase, registry: AuthoritativeSource[], now: Date): Promise<AuthoritativeSource[]> {
  const active = registry.filter((s) => s.monitoring_status === "ACTIVE");
  if (active.length === 0) return [];

  const { rows } = await db.withClient((client) =>
    client.query<{ source_id: string; next_run_at: Date }>(
      `SELECT source_id, next_run_at FROM crawl_schedules WHERE source_id = ANY($1::text[])`,
      [active.map((s) => s.source_id)],
    ),
  );
  const dueBySourceId = new Set(rows.filter((r) => new Date(r.next_run_at) <= now).map((r) => r.source_id));
  // A source with no crawl_schedules row at all (registry-load hasn't run
  // for it yet) is not due -- the scheduler only acts on sources the
  // registry loader has already provisioned scheduling state for.
  return active.filter((s) => dueBySourceId.has(s.source_id));
}

async function crawlOneSource(
  db: CrawlerDatabase,
  source: AuthoritativeSource,
  archive: DocumentArchive,
  acquisition: AcquisitionProvider,
): Promise<{ status: "SUCCEEDED" | "FAILED" | "PARTIAL" }> {
  const run = await startCrawlRun(db, source.source_id, FETCHER_VERSION);
  const crawlResult = await crawlSource(source, archive, db, run.id, acquisition);
  const status: "SUCCEEDED" | "FAILED" | "PARTIAL" =
    crawlResult.errors.length === 0 ? "SUCCEEDED" : crawlResult.documentsFetched > 0 ? "PARTIAL" : "FAILED";

  await finishCrawlRun(db, run.id, {
    status,
    linksDiscovered: crawlResult.linksDiscovered,
    documentsFetched: crawlResult.documentsFetched,
    newDocuments: crawlResult.newDocuments,
    replacementsDetected: crawlResult.replacementsDetected.length,
    errorSummary: crawlResult.errors.length > 0 ? crawlResult.errors.join("; ") : null,
  });

  return { status };
}

async function recordScheduleOutcome(
  db: CrawlerDatabase,
  sourceId: string,
  status: "SUCCEEDED" | "FAILED" | "PARTIAL",
  now: Date,
): Promise<void> {
  await db.withClient(async (client) => {
    const { rows } = await client.query<{ cadence: Cadence }>(`SELECT cadence FROM crawl_schedules WHERE source_id = $1`, [sourceId]);
    const cadence = rows[0]?.cadence ?? "DAILY";
    const nextRunAt = computeNextRunAt(cadence, now);

    if (status === "FAILED") {
      await client.query(
        `UPDATE crawl_schedules
         SET last_run_at = $2, next_run_at = $3, consecutive_failures = consecutive_failures + 1, updated_at = now()
         WHERE source_id = $1`,
        [sourceId, now.toISOString(), nextRunAt.toISOString()],
      );
    } else {
      await client.query(
        `UPDATE crawl_schedules
         SET last_run_at = $2, last_success_at = $2, next_run_at = $3, consecutive_failures = 0, updated_at = now()
         WHERE source_id = $1`,
        [sourceId, now.toISOString(), nextRunAt.toISOString()],
      );
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
