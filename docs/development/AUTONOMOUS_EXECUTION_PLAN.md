# Autonomous Execution Plan — Persistence, Battery Model, Platform API

Date: 2026-07-31
Branch: `feature/bess-tariff-api-optimisation`

## Current architecture assessment

The calculator's calculation foundation matches its design docs closely:

- **Calculation engine** (`src/engine/dispatchEngine.ts`, `financialEngine.ts`,
  `validationEngine.ts`) — SOC simulation, priority-based dispatch, savings
  breakdown, NPV/IRR/LCOS, static + simulation-output validation. Matches
  `CALCULATION_ENGINE_DESIGN.md`. 45 tests passing.
- **Tariff engine** (`src/tariff/`) — energy charges, demand charges, billing
  demand (ratchet/window), export rules, taxes/duties, orchestrated via
  `tariffEngine.ts`. Matches `TARIFF_ENGINE_DESIGN.md`.
- **Optimisation engine** (`src/optimisation/`) — Level 1 heuristic dispatch
  and Level 2/3 LP/MILP via `javascript-lp-solver`, plus a heuristic-vs-LP
  comparison module. Matches `OPTIMISATION_ENGINE_DESIGN.md` through Level 3;
  Level 4 (MPC) and Level 5 (AI) are correctly deferred, not a gap.
- **Import engine** (`src/import/`) — CSV ingestion, row validation, cadence
  detection, error reporting.
- **API layer** (`server/`) — Express 5, stateless compute endpoints
  (`simulation/run`, `tariff/calculate`, `optimisation/run`, `importValidate`,
  `health`), correlation-ID + structured logging + centralised error handling.
- **UI** (`src/components/`) — wizard, results dashboard, interval simulation
  view, sensitivity, export/legacy comparison modals.

Two gaps stand out against the architecture docs and the product strategy's
"onion" progression:

1. **No persistence layer at all.** Every architecture doc
   (`BESS_SYSTEM_ARCHITECTURE.md`, the coding specification) assumes a data
   platform underneath the calculation engine — Customer, Site, Tariff
   Version, Calculation, Audit Log. Today the app is pure request-in/
   response-out; nothing survives a single HTTP call. This blocks the
   platform from ever answering "show me this customer's past assessments"
   or providing an audit trail for an investment-grade calculation.
2. **Battery model stops at Level 1.** `BATTERY_MODEL_ARCHITECTURE.md` specifies
   a Level 1 (commercial, flat annual %) → Level 2 (engineering: cycle/
   calendar/DoD/C-rate ageing) → Level 3 (digital twin) progression. Today's
   code only has Level 1, inlined as a single `degradationCostPerKwh`
   coefficient inside `dispatchEngine.ts` and `lpModel.ts` — there is no
   separate, reusable battery module at all.

## Selected implementation priorities (this pass)

In priority order, matching the mission brief:

1. **Persistence layer** — Prisma + PostgreSQL, minimum viable entities
   (Project, Scenario, IntervalDataset/IntervalRecord, SimulationRun,
   SimulationResult), additive migrations against the already-provisioned
   `bess` database on staging (`prjx1`) then prod (`prjx6` Patroni cluster,
   via HAProxy primary).
2. **Persistence-aware API** — new `/api/v1/projects`, `/scenarios`,
   `/datasets/import`, `/simulations` routes that wrap the existing engine
   functions unchanged. Existing stateless routes are untouched and must
   keep working with the DB unreachable.
3. **Battery model (Level 2 engineering foundation)** — new `src/battery/`
   module: throughput ageing, cycle ageing (DoD/cycle-count/C-rate),
   calendar ageing (time + temperature-factor placeholder), a small preset
   library. Explicitly additive — does not touch the existing flat
   degradation coefficient inside `dispatchEngine.ts`/`lpModel.ts`, and does
   not change `financialEngine.ts`'s existing `effectiveCapacityPct`
   contract.
4. **Verification** — persistence CRUD tests, a reproducibility test,
   an audit test (every run captures engine version/timestamp/inputs/
   warnings), and battery degradation unit tests. All 45 pre-existing tests
   must remain green throughout.
5. **CI/deployment** — an ephemeral Postgres service container for CI only
   (never staging/prod); `docker-compose.yml` gets `DATABASE_URL` passthrough
   documentation, not a new bundled Postgres service (staging/prod already
   exist externally and must not be duplicated).

Explicitly not touched: the calculation/tariff/optimisation engines
themselves, the UI, MPC/AI optimisation, a battery physics/digital-twin
model, and the separate India tariff-crawler workstream
(`worktree-india-tariff-data` branch) — out of scope by design.

## Risks

- **Two independent databases (staging + prod), reached only through
  pre-existing SSH tunnels.** Mitigation: schema/migration is written once,
  applied via `prisma migrate dev` against staging first, verified, then
  `prisma migrate deploy` (non-interactive, no shadow DB) against prod.
  Never connect directly to a Patroni node — always via the HAProxy port.
- **Credential handling.** `DB_STG_*`/`DB_PROD_*` values live in the
  gitignored `bess-calc/.env`; Prisma needs a single `DATABASE_URL`. A small
  local script composes `DATABASE_URL` from the existing discrete env vars
  at migration/runtime rather than duplicating secrets into a second format
  or committing anything.
- **JSON-heavy schema.** `SimulationResult` and related types are large
  nested objects. Fully normalizing them now would be premature; v1 schema
  uses `Json` columns for nested breakdowns and keeps only what's needed for
  querying (IDs, foreign keys, status, timestamps, top-line financial
  numbers) as real columns. Documented explicitly in `DATABASE_DESIGN.md` as
  a deliberate v1 trade-off, not an oversight.
- **Breaking existing stateless routes.** Mitigated by never importing the
  Prisma client into the existing three route modules, and by an explicit
  verification step that hits them with `DATABASE_URL` pointed at an invalid
  value to prove no hard dependency was introduced.
- **CI adding a Postgres service could slow/flake CI.** Mitigated by scoping
  the new service container to the persistence test files only conceptually
  (Vitest doesn't support per-file service scoping, so the tradeoff is
  accepted: all tests in CI now assume a reachable ephemeral Postgres,
  documented in the CI workflow comments).

## Verification strategy

1. `npm test` — all existing + new tests green (persistence CRUD,
   reproducibility, audit, battery).
2. `npm run lint` — both tsconfigs (frontend + server) clean; `src/battery`
   added to `server/tsconfig.json`'s include list.
3. `npm run build && npm run build:server` — both succeed.
4. Manual smoke test of the full persistent workflow (project → scenario →
   dataset import → simulation → results) against the staging tunnel only.
5. Confirm existing stateless endpoints keep responding with `DATABASE_URL`
   deliberately broken, proving isolation from the new persistence layer.
6. Migration correctness: run against staging, inspect resulting schema,
   only then apply the identical migration to prod via `migrate deploy`.
