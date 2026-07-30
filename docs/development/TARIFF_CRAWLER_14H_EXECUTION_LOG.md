# India Tariff Crawler — Extended Execution Log

## Session scope and operating constraints

This log records a single-session, tool-driven engineering push on the India C&I
tariff crawler (`packages/india-tariffs/`), working in the `india-tariff-data`
worktree on branch `worktree-india-tariff-data`.

**Explicit scope decision (agreed with user at session start):** this session
completes staging-side work only — PostgreSQL foundation, registry expansion,
crawler hardening, tests, staging validation, deployment packaging and docs.
Production deployment to `prjxn2` and connection to production PostgreSQL are
held for a separate, supervised session where the user is actively present,
because that step has irreversible/shared-system blast radius that shouldn't be
taken unattended. This is a deviation from the original "14 hour unattended
including production deploy" brief, made transparently and recorded here.

---

## Hour 0 — Reconnaissance and baseline (2026-07-30)

### Worktrees / branches / remotes

- `C:/Software/bess` — branch `main`, up to date with `origin/main`, clean
  except untracked `.claude/` (session/tooling metadata, not a code change).
- `C:/Software/bess/.claude/worktrees/bess-calc` — branch `dev/bess-calc`.
  **Not touched** (separate workstream per instructions).
- `C:/Software/bess/.claude/worktrees/india-tariff-data` — branch
  `worktree-india-tariff-data`, tracking `origin/worktree-india-tariff-data`,
  working tree clean at session start. This worktree was flagged `locked` by
  git with a stale PID (47820, confirmed not running via
  `Get-Process`) — the lock was left behind by a previous session that ended
  without cleanup; safe to reuse since the tree is clean and pushed.

### Remotes

- `origin` → `git@github.com:rajatksud/bess.git`
- `bess-calc` → `git@github.com:rajatksud/bess-calc.git` (unrelated remote, ignored)

### Merged PRs (context only, all already merged, none touched)

- #4 BESS calculator foundation (bess-calc workstream)
- #3 Fix typo in DERC review comments
- #2 Document India C&I tariff data and crawler strategy
- #1 Bootstrap BESS calculator repository

### Baseline counts (packages/india-tariffs, before this session)

| Metric | Count |
|---|---|
| Jurisdictions defined | 36 (all 28 states + 8 UTs listed) |
| Jurisdictions `IN_PROGRESS` | 5 (MH, GJ, KA, TN status NOT_STARTED but TS/DL/MH/GJ/KA marked IN_PROGRESS — see note) |
| Jurisdictions `NOT_STARTED` | 31 |
| Regulators defined | 4 (KERC, DERC, GERC, MERC) — explicitly flagged in-file as unverified against source |
| Licensees defined | 1 (MSEDCL) |
| Authoritative sources defined | 5 (1 secondary/discovery-only FoR directory + 4 primary) |
| Sources with `monitoring_status: ACTIVE` | 0 (all `NOT_CONFIGURED`) |
| Adapters implemented | 1 (`generic_html_link_listing`) |
| PostgreSQL usage | **none** — crawler persists only to a local JSON manifest + content-addressed filesystem archive |
| CI workflows | **none** (`.github/` does not exist in this worktree) |
| Root workspace wiring | **none** (no root `package.json`; crawler is a standalone npm package under `packages/india-tariffs/crawler`) |
| `.env.example` for this package | **none** existed prior to this session |
| Crawler unit tests | 13, all passing (`npm test` in `packages/india-tariffs/crawler`) |
| Documented architecture | Thorough — `docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md` and `docs/architecture/AUTHORITATIVE_TARIFF_CRAWLER_ARCHITECTURE.md` are both complete, internally consistent design docs describing a much larger target system than currently implemented (PostgreSQL crawl state, object storage, classification, extraction, semantic diff, golden-bill regression, GitHub PR automation) |

### Code inspected

- `packages/india-tariffs/crawler/src/{types,registry,fetcher,crawl,cli,archive,classifier}.ts`
  and `src/adapters/genericHtmlLinkListing.ts` (659 lines total).
- Strong safety fundamentals already present: domain allowlisting enforced at
  fetch time, bounded redirects restricted to allowed domains, size caps,
  bounded retries with backoff, SHA-256 content-addressed storage, dedup by
  hash, in-place-replacement detection (`findReplacement`), per-domain rate
  limiting, documented User-Agent with contact info.
- Explicitly *not yet* present: PostgreSQL persistence of any kind, JSON
  Schema validation wired into the YAML loaders (schemas exist under
  `schemas/*.schema.json` but nothing validates registry YAML against them at
  load time), document classification beyond a single-branch stub, OCR/table
  extraction, semantic diff, golden-bill regression, scheduler/locking,
  environment guards (`APP_ENV` marker), CI.

### Environment

- `.env` in the worktree defines only **staging** DB vars
  (`DB_STG_HOST/PORT/NAME/ADMIN_USER/ADMIN_PASSWORD/USER/PASSWORD`); all
  `DB_PROD_*` vars are present but commented out. This is a safe existing
  posture — no accidental production connection is possible from this
  worktree's current `.env`.
- No `psql` CLI on PATH; Docker Desktop is available and working, no
  containers currently running.
- Node v24.11.1, npm 11.11.1.
- `gh` CLI authenticated and working.

### Baseline test run

```
cd packages/india-tariffs/crawler && npm test
tests 13, pass 13, fail 0
```

Recorded **before** any code changes this session.

---

## Work log

_(Entries appended chronologically below as work proceeds.)_

### PostgreSQL foundation (schema, migrations, env guards, DB client, registry loader)

Implemented under `packages/india-tariffs/crawler/src/db/`:

- `env.ts` — `loadDatabaseConfig("staging"|"production")` and
  `loadTestDatabaseConfig()`. Enforces `APP_ENV` must match the requested
  target; test config refuses to proceed unless a dedicated `DB_TEST_*`
  family exists or `DB_STG_NAME` ends in `_test`, so destructive test
  cleanup can never accidentally target a real database.
- `client.ts` (`CrawlerDatabase`) — pooled `pg.Pool` with configurable
  min/max pool size, connect timeout and statement timeout;
  `ensureEnvironmentMarker()` stores/checks a `deployment_metadata.environment`
  row so a process can never silently operate against a database that
  disagrees with its own `APP_ENV` (guards exactly the "local port forward
  might resolve to production" risk called out in the brief); transaction
  helper; database-backed `scheduler_locks` advisory locking
  (`tryAcquireSchedulerLock`/`releaseSchedulerLock`, non-blocking, TTL-based).
- `migrate.ts` — additive-only numbered SQL migration runner tracked in
  `schema_migrations`; idempotent (already-applied versions are skipped);
  refuses to run against a database marked `environment=production` unless
  `allowProduction` is explicitly passed (wired to `--production` CLI flag).
- `migrations/0001_init.sql` — full schema: jurisdictions, regulators,
  regulator_jurisdictions, licensees, authoritative_sources, crawl_schedules,
  crawl_runs, fetch_observations, source_documents, document_url_aliases,
  classification_results, extraction_jobs, extraction_attempts,
  candidate_tariffs, candidate_charge_components, field_citations,
  semantic_change_sets, validation_results, review_decisions,
  approved_tariffs, dataset_releases, scheduler_locks,
  source_health_observations. All timestamps `TIMESTAMPTZ`; foreign keys and
  uniqueness constraints throughout (e.g. `source_documents.sha256 UNIQUE`);
  `updated_at` maintained by trigger; candidate/approved tables are
  physically separate tables (not a status flag on one table) so unreviewed
  data cannot reach the approved table via anything but the explicit
  `review_decisions` → `approved_tariffs` path.
- `registryLoader.ts` — idempotent upsert loader from the human-reviewed
  YAML files into Postgres (`ON CONFLICT ... DO UPDATE` keyed on each
  entity's stable natural code). Registry data always originates from YAML,
  never from crawler discovery.
- `cli.ts` extended with `migrate`, `registry-load`, `source-health` commands.

**Build fix**: `tsc` does not copy non-`.ts` files, so `.sql` migration files
were missing from `dist/`. Added a `copy-migrations` script (plain Node,
cross-platform) run as part of `build`.

**Bug caught before commit**: a JSDoc comment in `env.ts` contained the
literal substring `DB_STG_*/DB_PROD_*`, whose `*/` prematurely closed the
block comment and left the next few lines parsed as code, producing a wall
of cascading `tsc` syntax errors. Fixed by rewording the comment. Worth
remembering as a recurring hazard when writing comments that mention
wildcard env-var patterns.

**Verified against a disposable local Postgres container** (see below for why
this was replaced): migration applied cleanly to a brand-new database
(`0001_init` applied, schema created), and re-running `migrate` was a
confirmed no-op (`Already current: 1`, `Applied: (none, already current)`) —
idempotency requirement met.

### Correction: staging/production database targets

Initial approach stood up a disposable local Docker Postgres container
(`bess-tariff-crawler-staging-pg`, port 5544) for staging, reasoning that the
`.env`'s pre-existing `DB_STG_*` values (host `localhost:5433`, database
`bess`, user `bess_admin`) looked like the **bess-calc workstream's**
database, not something this workstream should reuse or write into — and the
brief explicitly warns not to assume a local port is safe/isolated.

The user corrected this **mid-session**: staging is `localhost:5433` and
production is `localhost:15433` (a real, already-running Postgres
instance — the user will supply credentials directly in `.env`). The Docker
container was stopped and removed
(`docker stop/rm bess-tariff-crawler-staging-pg`). `.env` now points
`DB_STG_HOST/PORT` at `localhost:5433` with a **dedicated database name**
(`tariff_crawler_staging`, distinct from the `bess` database used by
bess-calc) so the two workstreams' tables stay isolated even though they
share the same Postgres server process. Credential fields are left blank
pending the user filling them in. Production vars remain commented out
pending the supervised production session.

This is exactly the kind of environment-identity question the brief called
out as something to resolve from explicit configuration/user input rather
than assumption — recorded here as a real-time course correction, not a
mistake to silently paper over.
