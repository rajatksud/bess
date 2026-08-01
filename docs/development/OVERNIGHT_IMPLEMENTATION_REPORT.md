# Overnight Implementation Report — Persistence, Battery Model, Platform API

Date: 2026-08-01
Branch: `feature/bess-tariff-api-optimisation`
Commits this session: `30103b3`..`cc86e1d` (6 commits, listed below)

Mission: move the BESS calculator from a stateless calculation engine to a
persistent, auditable assessment platform, per
`docs/development/AUTONOMOUS_EXECUTION_PLAN.md` (written at the start of
this session) and the approved plan. Executed in a single continuous
foreground session with staged, logical commits per objective, all human
decisions (execution mode, DB endpoints, credential handling, commit
granularity, API compatibility policy) resolved up front before coding
began.

## Completed

### 1. Persistence layer (`feat(db)`, commit `30103b3`)

- Prisma ORM **6.19.3** (deliberately pinned, not 7.x — see "Architecture
  decisions" below), schema at `bess-calc/prisma/schema.prisma`: `Project`,
  `Scenario`, `IntervalDataset`/`IntervalRecord`, `SimulationRun`,
  `SimulationResult`. JSON columns for large nested engine output
  (`SavingsBreakdown`, `TechnicalResult`, `FinancialResult`, tariff/battery/
  solar/generator configs); real columns only for what needs to be queried
  directly (IDs, status, timestamps, top-line financial numbers). Rationale
  documented in `docs/database/DATABASE_DESIGN.md`.
- Initial migration (`prisma/migrations/20260731150925_init/`) generated via
  `prisma migrate diff` (not `migrate dev`, which needs shadow-database
  creation rights the shared `bess_admin` role doesn't have — confirmed via
  a real `P3014 permission denied to create database` error) and applied via
  `prisma migrate deploy` to **staging first** (`prjx1`, via the existing
  `localhost:5433` SSH tunnel), verified, then to **prod**
  (`prjx6` Patroni cluster, via HAProxy's primary port through the existing
  `localhost:15433` tunnel — never a direct node connection).
- `scripts/composeDatabaseUrl.mjs` composes a Prisma `DATABASE_URL` from
  this repo's existing discrete `DB_STG_*`/`DB_PROD_*` env vars (no
  `dotenv` dependency existed, and the app has no single `DATABASE_URL`
  convention before this) — the admin credential is never duplicated into a
  second format, and nothing is ever printed/logged.
- The `bess` database on both hosts was pre-provisioned infrastructure
  (found, not created, by this session); the `bess_user` application role
  did not exist on staging when first tested and was created by the user
  mid-session (grant script preserved at
  `docs/database/sql/grant_bess_user_privileges.sql`).

### 2. Persistent API layer (`feat(api)`, commit `d3b8c9f`)

- New routes, additive only: `GET/POST /api/v1/projects`,
  `GET /api/v1/projects/:id`, `POST /api/v1/projects/:id/scenarios`,
  `GET /api/v1/scenarios/:id`, `POST /api/v1/datasets/import`,
  `POST /api/v1/simulations`, `GET /api/v1/simulations/:id`,
  `GET /api/v1/simulations/:id/results`. Follow the existing Express
  Router + Zod + `{result, correlationId}`/error-envelope conventions
  exactly (`server/routes/*.ts`, `server/lib/errors.ts`).
- `AppOptions.prismaClient` added to `createApp()` so tests can inject a
  client independent of the process-wide lazy singleton
  (`server/lib/prisma.ts`) — the pre-existing stateless routes
  (`simulation/run`, `tariff/calculate`, `optimisation/run`) never touch
  Prisma at all and were verified to keep responding correctly with
  `DATABASE_URL` deliberately broken.
- **Found and fixed a real gap**: the CSV import pipeline (`src/import/`)
  and the dispatch engine (`src/engine/dispatchEngine.ts`) had never been
  wired together anywhere in the app — only synthetic `presetProfiles.ts`
  data ever reached the engine. Added
  `src/import/toEngineIntervals.ts`, mirroring `presetProfiles.ts`'s own
  pre-simulation defaults and TOU-resolution logic, so imported CSV data
  can now actually drive a simulation.
- Verified end-to-end (project → dataset import → scenario → simulation →
  results) manually against staging before writing automated tests.

### 3. Battery model (`feat(battery)`, commit `96f5fdd`)

- `src/battery/`: `batteryModel.ts` (config type), `cycleCounting.ts`
  (simplified DoD-bin half-cycle extraction + DoD-weighted equivalent-full-
  cycle counting), `degradationModel.ts` (combines throughput, cycle
  [DoD + C-rate stress], and calendar [elapsed time + Arrhenius-style
  temperature factor] ageing into an SOH estimate), `batteryLibrary.ts`
  (default preset mirroring `src/App.tsx`'s `INITIAL_SYSTEM`: 125 kW /
  261 kWh LFP, 6000 cycles).
- Level 2 (engineering) per `docs/architecture/BATTERY_MODEL_ARCHITECTURE.md`'s
  Level 1/2/3 progression — explicitly labelled as an engineering
  approximation, not physics-accurate, in the module's own doc comments.
  The doc gives no concrete formulas, so standard published simplified
  engineering approximations were used (documented inline).
- Purely additive: does not touch `dispatchEngine.ts`'s or `lpModel.ts`'s
  existing flat `degradationCostPerKwh` coefficient (Level 1), and does not
  change `financialEngine.ts`'s `effectiveCapacityPct`/replacement-CapEx
  contract.

### 4. Verification suite (`test`, commit `79ff597`)

- 29 battery tests (`src/battery/__tests__/`): config validation, cycle
  counting (flat trace → 0 half-cycles, monotonic → 1, full swing → 2,
  multi-reversal traces), degradation (increases with throughput, deeper
  DoD cycles degrade faster, higher C-rate/temperature increase ageing,
  SOH floors at 0 and ceils at `initialSohPct`, input validation).
- 20 persistence tests (`server/__tests__/{projects,scenarios,datasets,
  simulations}.test.ts`) via an injected `PrismaClient`, self-skipping
  (not failing) when `DATABASE_URL` is unset so `npm test` still works
  without DB access. Includes:
  - **Reproducibility**: the same scenario run twice produces
    byte-identical `technicalResult`/`savingsBreakdown`/`npv`/
    `totalSavings`.
  - **Audit trail**: every persisted `SimulationRun` carries
    `engineVersion` (`CALCULATION_ENGINE_VERSION`), `startedAt`/
    `completedAt` timestamps, and a complete `inputSnapshot`; every
    `SimulationResult` carries its `warnings` array.
  - Each test cleans up its own project (cascading through
    scenarios/datasets/runs/results) in `afterEach`; verified staging is
    left with zero leftover rows after every full run this session.

### 5. CI / deployment (`ci`, commit `9e8f279`; `fix(deploy)`, commit `cc86e1d`)

- CI's `test` job gains a throwaway `postgres:16-alpine` service container
  (wiped when the job ends, never staging/prod), `DATABASE_URL` set to it,
  `prisma migrate deploy` run before `npm test` — so all 228 tests
  (not just the 208 DB-independent ones) run on every PR/push.
- `docker-compose.yml` gets a documented `DATABASE_URL` passthrough for the
  app container. Deliberately does **not** bundle its own Postgres service
  — staging/prod are pre-provisioned external infrastructure, and bundling
  a second database here risks divergence.
- **Found and fixed a real deployment bug during verification**: the
  Dockerfile's runtime stage ran `npm ci --omit=dev`, which installs the
  `@prisma/client` package but never generates its actual client code
  (`node_modules/.prisma/client`, including the platform-specific query
  engine binary) — `prisma` (the generator CLI) is a devDependency, omitted
  by design in that stage. Fixed by running `prisma generate` in the build
  stage (same linux/alpine base as runtime, so the generated engine binary
  is correct) and copying `node_modules/.prisma` into the runtime stage.
  This would have caused the deployed container's first database query to
  fail with a missing-generated-client error, undetected by local
  `npm run build:server` since the host's own `node_modules/.prisma` was
  already present from earlier `prisma generate` runs.

## Verification

All four commands run clean at the end of this session:

```
npm test          → 34 test files, 228 tests: 208 passed + 20 passed against staging
                     (20 self-skip without DATABASE_URL; run for real in CI and were
                     run for real against staging multiple times this session)
npm run lint       → tsc --noEmit (frontend) && tsc -p server/tsconfig.json --noEmit: clean
npm run build      → vite build: succeeds (pre-existing >500kB chunk warning, unrelated)
npm run build:server → tsc + tsup: succeeds, 113.15 KB bundle
```

Additional manual verification this session:
- Full persistent workflow (project → dataset import → scenario →
  simulation → results) exercised end-to-end against staging.
- Stateless routes (`simulation/run`, `tariff/calculate`,
  `optimisation/run`, `health`) confirmed to respond correctly with
  `DATABASE_URL` pointed at an unreachable address.
- `prisma migrate status` on both staging and prod: "Database schema is up
  to date."
- Staging and prod `projects` table row counts confirmed at 0 after every
  test run this session (no leftover data).
- `docker compose config` validates with the new `DATABASE_URL` variable.
- `prisma generate` confirmed to work with no `.env` file and no
  `DATABASE_URL` present at all (build-stage requirement).

## Database

- **Migrations created**: one, `20260731150925_init` — creates all six
  tables (`projects`, `scenarios`, `interval_datasets`, `interval_records`,
  `simulation_runs`, `simulation_results`) and their foreign keys. Applied
  to both staging and prod via `prisma migrate deploy`.
- **Schema changes**: none beyond the initial migration — no existing
  tables were touched (the `bess` database was empty on both hosts before
  this session).
- **Rollback approach**: documented in `docs/database/MIGRATION_GUIDE.md` —
  migrations are additive-only; rolling back means writing and applying a
  new migration that drops exactly what a bad migration added, never a
  blanket reset. Not exercised this session (no bad migration occurred).

## Remaining gaps (explicitly out of scope, unchanged from the plan)

- **MPC (Optimisation Level 4) / AI-assisted optimisation (Level 5)** —
  correctly deferred per `OPTIMISATION_ENGINE_DESIGN.md`'s own phasing; no
  code exists for either.
- **Battery digital twin (Level 3)** — out of scope; `src/battery/` stops
  at Level 2 (engineering approximation), as directed.
- **India tariff crawler / `packages/india-tariffs` integration** — lives
  on the separate `worktree-india-tariff-data` branch, untouched,
  uninspected beyond confirming its existence, per explicit instruction.
- **Full normalization of `SimulationResult`'s nested output** — v1
  deliberately keeps large nested objects as JSON columns; documented as a
  conscious trade-off in `DATABASE_DESIGN.md`, not an oversight.
- **Frontend UI wiring for the new persistent workflow** — the React app
  (`src/components/`, `src/App.tsx`) still only drives the stateless
  `/simulation/run` path; no UI was added or changed to create
  projects/scenarios or browse past runs. The API exists; nothing in the
  UI calls it yet.
- **bess_user role provisioning was manual, mid-session** — the grant
  script is preserved (`docs/database/sql/grant_bess_user_privileges.sql`)
  but role creation itself was not automated (reasonably — it involves a
  live password from `.env`); a fresh environment (e.g. a new prod-like
  target) would need this step repeated by hand.

## Morning review plan

1. **First files to review**: `bess-calc/prisma/schema.prisma` (the data
   model — cheapest to review, hardest to change once real data exists),
   then `server/routes/simulations.ts` (the most complex new route — loads
   a scenario, bridges imported data through the engine, persists
   run+result, handles the failure path).
2. **First APIs to test**: `POST /api/v1/projects` →
   `POST /api/v1/datasets/import` → `POST /api/v1/projects/:id/scenarios`
   → `POST /api/v1/simulations` → `GET /api/v1/simulations/:id/results`,
   against staging (`node scripts/composeDatabaseUrl.mjs staging app --
   npm run dev:server`) — this is the same sequence verified manually and
   in the automated test suite this session.
3. **Known risks**:
   - The Docker image fix (Prisma client generation) was found and fixed
     but not verified inside an actual running container in this session
     (the local Docker daemon wasn't reachable) — worth a real
     `docker build && docker run` smoke test before this ships.
   - `src/import/toEngineIntervals.ts`'s pre-simulation defaults
     (`bessSocPct: 80`, etc.) are mirrored from `presetProfiles.ts` by
     convention, not derived from any documented spec — worth a second
     look if imported-data simulations start behaving unexpectedly.
   - No frontend UI consumes the new persistent API yet — it's
     API-complete but not user-reachable through the existing app.
4. **Recommended next sprint**:
   - Wire the frontend to the new persistent workflow (project/scenario
     creation, run history) — the highest-value next step now that the
     backend exists.
   - Real Docker container smoke test of the Prisma-generation fix.
   - Consider whether `src/battery/`'s degradation model should be wired
     into `SimulationRun`'s persisted output (currently computed but not
     yet consumed by any route) as an optional richer degradation report.
   - Phase 3+ roadmap items (India tariff crawler merge, MPC, digital
     twin) remain deferred per existing product strategy phasing — no
     change recommended from this session's findings.
