# Current Code Architecture

Status: describes the repository **as implemented**, verified against source
on 2026-08-03 on `dev/bess-calc` (merge commit `549e01c`). This is a
snapshot, not a living document — regenerate the machine-derived parts via
`npm run architecture:generate` (see `bess-calc/scripts/`) and re-verify the
prose parts by hand when the module structure changes materially.

This document is the "as-built" counterpart to two other documents that are
easy to confuse it with:

- [`BESS_SYSTEM_ARCHITECTURE.md`](./BESS_SYSTEM_ARCHITECTURE.md) is
  **target-state / aspirational** — it describes a future Next.js frontend,
  Python optimisation services, and a generic "API Gateway" that do not
  exist in this repository today. Do not cite it as a description of current
  behaviour.
- [`../database/DATABASE_DESIGN.md`](../database/DATABASE_DESIGN.md) and
  [`../development/IMPLEMENTATION_STATUS.md`](../development/IMPLEMENTATION_STATUS.md)
  are accurate and current; this document links to them rather than
  restating their content.

See also the machine-readable companion in [`../../.agent/`](../../.agent/README.md),
which is optimised for an agent to load only the files relevant to a task.

## System overview

The entire runtime lives under `bess-calc/` (the repository root's `docs/`,
`db/`, and `scripts/` are documentation and deployment glue, not code). It is
a single Node/TypeScript project with three layers that share one
`tsconfig.json`-rooted source tree but run in different processes:

```
bess-calc/
├── src/                  React SPA (Vite) — also directly imports the
│                         calculation engine modules for client-side runs
│   ├── engine/           dispatch, financial, validation, preset profiles
│   ├── battery/          battery library, degradation, cycle counting
│   ├── tariff/           tariff engine (energy/demand charges, taxes, export rules)
│   ├── optimisation/     LP-based and heuristic dispatch, comparison
│   ├── import/           CSV import, validation, timestamp/cadence handling
│   ├── components/       React UI, no calculation logic (see IMPLEMENTATION_STATUS.md)
│   └── types/            shared TypeScript types (bess.ts is the source of truth
│                         for shapes stored as JSON in Postgres — see Data Architecture)
├── server/               Express API (separate entrypoint, separate tsconfig)
│   ├── routes/           stateless routes + Prisma-backed persistence routes
│   ├── middleware/       correlation id, request logging, error handling
│   └── lib/              Prisma client singleton, logger, errors, version
└── prisma/               schema.prisma + migrations (PostgreSQL)
```

Frontend (`src/`) and backend (`server/`) are two separate TypeScript
programs (`tsconfig.json` vs `server/tsconfig.json`, built separately via
`npm run build` / `npm run build:server`) that both import from the same
engine/tariff/optimisation/import modules. This is deliberate: the
calculation engine is designed to run identically in-browser (fast,
zero-round-trip UI feedback) and on the server (for persisted, reproducible
runs) — see `CALCULATION_ENGINE_DESIGN.md`.

## Major modules

| Module | Responsibility | Depends on (verified via `.agent/graph/import-graph.json`) |
|---|---|---|
| `src/engine/dispatchEngine.ts` | Per-interval battery dispatch simulation (priority-ordered: backup_reserve, peak_shaving, solar_self_consumption, diesel_displacement, tou_arbitrage) | `src/types/bess.ts` only — battery/tariff/optimisation math is inlined here, not imported from those sibling modules |
| `src/engine/financialEngine.ts` | NPV/IRR/LCOS/payback from a dispatch result | `src/types/bess.ts` only |
| `src/engine/validationEngine.ts` | Static config validation + post-simulation physical/commercial sanity checks | `src/types/bess.ts` only |
| `src/engine/legacyEngine.ts` | Intentionally-flawed sales-pitch arithmetic, kept as a documented counter-example for the Comparison tab | `src/types/bess.ts` only |
| `src/engine/presetProfiles.ts` | Synthetic load/solar interval generators for the three built-in scenarios | `src/types/bess.ts` only |
| `src/battery/` | Battery capacity/degradation/cycle-counting model | Internal only (`batteryModel.ts` has zero imports; not currently imported by `src/engine/`) |
| `src/tariff/tariffEngine.ts` | Energy + demand charges, taxes/duties, export rules, billing-demand rules | `src/tariff/types.ts` and sibling `src/tariff/*.ts` files only |
| `src/optimisation/lpModel.ts` | LP-based optimal dispatch via `javascript-lp-solver` | `src/optimisation/types.ts` only |
| `src/optimisation/heuristicDispatch.ts` | Rule-based dispatch alternative to the LP solver | `src/optimisation/types.ts` only |
| `src/optimisation/comparison.ts` | Compares heuristic vs. LP dispatch outcomes | `src/optimisation/types.ts` (not `lpModel.ts`/`heuristicDispatch.ts` directly — `optimisedDispatch.ts` is the module that imports both) |
| `src/import/csvImporter.ts` | CSV parsing (Papaparse) → validated interval rows | `rowValidation.ts`, `timestampUtils.ts`, `cadence.ts`, `types.ts` |
| `src/import/toEngineIntervals.ts` | Converts imported rows into the engine's interval input shape | `src/import/types.ts`, `src/types/bess.ts` |
| `server/routes/*.ts` | HTTP boundary — see API map in `.agent/architecture/execution-flows.md` | `simulation.ts`/`simulations.ts` import `src/engine/*` + `src/types/bess.ts` directly; `tariff.ts` imports `src/tariff/index.ts`; `optimisation.ts` imports `src/optimisation/*`; `datasets.ts`/`importValidate.ts` import `src/import/index.ts`; persistence routes additionally use `server/lib/prisma.ts` |
| `server/lib/prisma.ts` | Lazily-constructed shared `PrismaClient`; routes accept an injected client for tests | `prisma/schema.prisma` (via `@prisma/client`) |

**Note on `src/battery/`**: despite being documented conceptually as part of
the dispatch/degradation model, the import graph shows `src/engine/dispatchEngine.ts`
and `src/engine/financialEngine.ts` do not currently import anything from
`src/battery/` — degradation logic referenced in `IMPLEMENTATION_STATUS.md`
("degradation-derated cash flows") is exercised through `src/battery/`'s own
tests, not through a live import from the engine layer at the time of this
snapshot. Verify with `.agent/graph/import-graph.json` before assuming a
call path between these modules.

## Data flow

Two independent execution paths exist for "run a simulation":

1. **Client-side (stateless, no persistence)** — `src/App.tsx` calls
   `runIntervalDispatch` → `calculateFinancialMetrics` →
   `validateSimulationResult` directly in the browser. Nothing is saved.
   Used for the interactive quick-estimate/wizard flow.
2. **Server-side (persistence-backed)** — `POST /api/v1/simulations` reads a
   `Scenario` (and its `IntervalDataset`/`IntervalRecord`s) from Postgres via
   Prisma, runs the same engine modules, and writes a `SimulationRun` +
   `SimulationResult` back. `GET /api/v1/simulations/:id/results` retrieves
   it. This is the reproducible/auditable path — `inputSnapshot` on
   `SimulationRun` captures every input the engine actually consumed
   (see `prisma/schema.prisma`'s own comments).

`server/routes/simulation.ts` (`POST /simulation/run`, singular, stateless)
and `server/routes/simulations.ts` (`POST /simulations`, plural,
Prisma-backed) are two **different, coexisting** routes — the naming is
close enough to cause confusion; see `.agent/architecture/execution-flows.md`
for the exact distinction before touching either.

## Dependency boundaries

- **Engine modules (`src/engine/`, `src/battery/`, `src/tariff/`,
  `src/optimisation/`, `src/import/`) have zero dependency on Express,
  Prisma, or React.** This is enforced by convention, not tooling, today —
  `CALCULATION_ENGINE_DESIGN.md` states the intent; `.agent/architecture/dependency-map.md`
  and the `architecture:check` script (dependency-cruiser) make it possible
  to verify mechanically going forward, but no rule currently fails CI if
  this boundary is crossed.
- **`server/app.ts` explicitly separates stateless routes (no Prisma
  dependency) from persistence routes (constructed with an injected
  `PrismaClient`)** — see the comment on `AppOptions.prismaClient` in
  `server/app.ts`. Tests exploit this to run persistence routes against a
  real ephemeral Postgres (`server/__tests__/persistenceTestSetup.ts`) while
  stateless routes need no database at all.
- **The Prisma schema is deliberately JSON-heavy** (engine input/output
  blobs stored as `Json` columns rather than fully normalized) — documented
  as an intentional v1 trade-off in `prisma/schema.prisma`'s header comment
  and `DATABASE_DESIGN.md`, not an oversight.

## Current technical debt

(Cross-referenced from `IMPLEMENTATION_STATUS.md`'s "Known issues" section —
not re-derived here; consult that document for full detail and dates.)

1. `peak_shaving`'s dispatch trigger compares against gross `loadKw`, not
   load net of solar — a known incompleteness in the peak-shaving /
   solar-self-consumption interaction.
2. Dispatch priority *order* materially changes simulation outcomes, and
   only a few orderings are tested — no exhaustive/property-based coverage.
3. Zero test coverage on React components (`src/components/*.tsx`); judged
   low-risk since they contain no calculation logic, but unverified.
4. `validateSimulationResult`'s energy-balance check replays SOC from
   `bessPowerKw` alone — it cannot catch a self-consistent but wrong
   dispatch *decision*, only an inconsistent SOC *integration*.
5. `legacyEngine.ts`'s sales-facing `dailySurplusSolarKwh` input has no
   cross-check against the interval simulation's solar output — intentional
   (it's the point of the Comparison tab) but no divergence warning exists.
6. No mechanical enforcement (lint rule, dependency-cruiser rule) of the
   "engine has zero Express/Prisma/React dependency" boundary described
   above — currently convention only.

## Future agent guidance

- Before editing anything under `src/engine/`, `src/battery/`, `src/tariff/`,
  or `src/optimisation/`, read `.agent/architecture/dependency-map.md` to see
  every module that imports the file you're changing (both the client
  `App.tsx` path and the server route path consume the same engine code —
  changes ripple through both).
- Do not add a new "one-battery-per-scenario-run" persistence shortcut that
  bypasses `inputSnapshot` — reproducibility depends on that snapshot being
  a complete, immutable copy (see `prisma/schema.prisma` comments).
- Do not treat `BESS_SYSTEM_ARCHITECTURE.md`, `TARIFF_ENGINE_DESIGN.md`,
  `OPTIMISATION_ENGINE_DESIGN.md`, or the product strategy doc as
  descriptions of current behaviour — cross-check any claim from those
  documents against this one or the source before acting on it.
- Follow `bess-calc/CLAUDE.md`'s task protocol (inspect smallest relevant
  file set → implement smallest complete change → run focused tests → report)
  and `.claude/rules/docs.md` (keep implemented vs. planned distinguishable)
  for any follow-up work.
