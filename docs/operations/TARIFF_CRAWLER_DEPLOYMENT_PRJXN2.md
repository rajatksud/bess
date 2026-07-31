# India Tariff Crawler — Deployment Runbook (prjxn2)

## Status

This runbook documents the intended deployment procedure for the India
tariff crawler on `prjxn2`. **Production deployment has not yet been
executed** as of the writing of this document — it is held for a separate,
supervised session where the operator is actively present, per the explicit
scope agreement recorded in
[`../development/TARIFF_CRAWLER_14H_EXECUTION_LOG.md`](../development/TARIFF_CRAWLER_14H_EXECUTION_LOG.md).
Everything below through "Staging gate" has been exercised; everything from
"Production deployment" onward is the planned procedure, not yet-executed
history.

## Prerequisites

- Staging gate passed (migrations, registry load, idempotency — see the
  execution log for evidence already collected).
- SSH access to `prjxn2` as an operator who can inspect existing services
  before changing anything.
- The exact commit SHA to deploy has passed CI (`.github/workflows/india-tariffs-crawler.yml`):
  format/lint, unit tests, integration tests against a disposable Postgres,
  registry validation, and a Docker build.
- Production database connection details, provided only on the `prjxn2` host
  via a server-side `.env` (never committed — see `.env.example`).

## Image

Build context is `packages/india-tariffs/` (not `crawler/` alone), because
the image also ships the committed `registry/` and `schemas/` directories so
a deployed SHA has a reproducible registry snapshot:

```bash
cd packages/india-tariffs
docker build -t india-tariffs-crawler:<git-sha> -f Dockerfile .
```

The image:

- runs as a non-root `crawler` user;
- exposes a `HEALTHCHECK` that runs `node dist/src/cli.js verify` (loads and
  validates the registry YAML without touching the database or network);
- expects a volume mounted at `/app/data` for the persistent document
  archive and manifest (`CRAWLER_ARCHIVE_DIR=/app/data/.archive`, set by the
  image);
- has no default long-running process — it is invoked per-command
  (`migrate`, `registry-load`, `crawl`, `source-health`, `verify`); the
  scheduler/long-running process (if run as a persistent service rather than
  one-shot cron-style invocations) should wrap these commands, not replace
  them.

## Pre-change inspection on prjxn2

Before touching anything, inspect (do not assume):

```bash
ssh prjxn2
docker ps -a
docker network ls
ls -la /opt /srv  # or wherever deployments conventionally live on this host
systemctl list-timers --all       # scheduled jobs
crontab -l
df -h                              # disk capacity
cat /etc/caddy/Caddyfile 2>/dev/null  # or equivalent reverse-proxy config, read-only
```

Do not alter SSH configuration, firewall policy, unrelated containers,
unrelated Caddy routes, Patroni/HAProxy topology, or unrelated databases.

## Production PostgreSQL gate

1. Verify `APP_ENV=production` in the server-side `.env` matches the
   database's own recorded marker. `migrate` and `verifyEnvironmentMarker`
   (see [`../data/...`] and `src/db/env.ts`/`src/db/client.ts`) refuse to
   proceed on a mismatch — this is enforced in code, not just convention.
2. Confirm the target is the configured HAProxy/service endpoint for the
   Patroni cluster, if applicable — never an individual Patroni member
   directly.
3. Confirm the production role (`DB_PROD_USER`) is **not** a superuser and
   has only the grants documented below under "Least-privilege roles" — this
   should be verified with the DBA/operator before first use, the same way
   the staging role's grants were verified during the staging gate.
4. Back up the affected schema/reference data before migrating.
5. Record the current migration version:
   `node dist/src/cli.js migrate` reports "Schema version before" —
   capture this in the deployment log before proceeding.
6. Apply migrations with the explicit production flag:
   `APP_ENV=production node dist/src/cli.js migrate --production`.
   Migrations are additive-only (see `src/db/migrations/`); a destructive
   migration is never auto-applied — if one is genuinely required, it must
   be prepared and reviewed separately, never run via this command.
7. Load only verified registry data:
   `APP_ENV=production node dist/src/cli.js registry-load`.
8. Confirm no automated path can write to `approved_tariffs` — that table is
   only ever populated via `review_decisions`, which requires a human
   `reviewer` value (see `0001_init.sql`); no CLI command in this repo
   inserts into it.

## Least-privilege roles

Two roles per environment, matching `src/db/env.ts`'s `loadDatabaseConfig(target, role)`:

| Role | Env vars | Used by | Privileges |
|---|---|---|---|
| Admin | `DB_*_ADMIN_USER` / `DB_*_ADMIN_PASSWORD` | `migrate` only | Schema owner: `CREATE`, `ALTER`, `DROP` within its own schema. Not database-server superuser. |
| App | `DB_*_USER` / `DB_*_PASSWORD` | `registry-load`, `crawl`, `source-health` | `CONNECT` on the database, `USAGE` on the `tariff_crawler` schema, `SELECT/INSERT/UPDATE/DELETE` on its tables, plus matching `ALTER DEFAULT PRIVILEGES` so new tables from future migrations inherit the same grants. No DDL. |

On the staging instance, the grants were applied as:

```sql
GRANT CONNECT ON DATABASE tariff_crawler_staging TO tariff_crawler_user;
GRANT USAGE ON SCHEMA tariff_crawler TO tariff_crawler_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tariff_crawler TO tariff_crawler_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tariff_crawler TO tariff_crawler_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA tariff_crawler GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tariff_crawler_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA tariff_crawler GRANT USAGE, SELECT ON SEQUENCES TO tariff_crawler_user;
```

The equivalent should be applied for the production app role before first
use, with the production admin role, by whoever administers that instance.

## Service launch (planned)

1. Choose an isolated, clearly named directory on `prjxn2` for this
   deployment (do not reuse an unrelated directory).
2. Pull or build the SHA-tagged image.
3. Install the server-side `.env` outside Git with restricted permissions
   (e.g. `chmod 600`, owned by the service user).
4. Run `migrate --production` (see above).
5. Run `registry-load`.
6. Start the service (health command: `verify`).
7. Run one restricted smoke crawl against a proven, low-volume source.
8. Confirm the resulting `crawl_runs`/`fetch_observations`/`source_documents`
   rows in Postgres.
9. Repeat the same source crawl once more and confirm deduplication (same
   `source_documents.sha256`, no new row, `document_url_aliases` unchanged
   unless the URL genuinely differs).
10. Restart the service/container and confirm state persists (registry rows,
    schema_migrations version, and the `/app/data` volume's archive/manifest
    all survive the restart).
11. Confirm the scheduler advisory lock (`scheduler_locks` table,
    `tryAcquireSchedulerLock`/`releaseSchedulerLock` in `src/db/client.ts`)
    behaves correctly if more than one instance could start concurrently.
12. Watch logs briefly for crash loops.
13. Record: deployed SHA, image tag, timestamp, schema/migration version,
    and the rollback procedure below.

## Rollback procedure

1. Stop the new container/service.
2. Because migrations in this system are additive-only, rolling back code
   does not require a destructive schema rollback in the common case — the
   previous image version's code is compatible with a schema that has extra
   (unused) objects from a newer migration.
3. Restart the previous known-good image tag.
4. If a specific migration must be reverted, write and review a new forward
   migration that undoes the specific additive change (e.g. drops a column
   added in error) rather than editing or removing the original migration
   file.
5. Registry data is reloaded from the committed YAML at any time via
   `registry-load` and is not destructively overwritten by a rollback.

## Backup and restore

- Take a `pg_dump` of the `tariff_crawler` schema before any production
  migration:
  `pg_dump -h <prod-host> -p <prod-port> -U <admin> -n tariff_crawler -d <db> -F c -f backup.dump`
- Restore with `pg_restore -h ... -d ... backup.dump` into a fresh or
  cleaned schema, never over a live schema with newer data without explicit
  confirmation.
- The immutable document archive (mounted at `/app/data`) should be backed
  up separately (e.g. periodic snapshot of the volume) since it is not part
  of the Postgres dump.

## What production writes are, and are not, allowed to do

Allowed: verified registry/reference records, crawl schedules, crawl runs,
fetch/document metadata, source health, classifications, extraction
candidates, validation results, review queues.

Not allowed, and not implemented by any command in this repo: automatically
creating an `approved_tariffs` row, or otherwise bypassing the
`review_decisions` → `approved_tariffs` path with a human `reviewer` value.
