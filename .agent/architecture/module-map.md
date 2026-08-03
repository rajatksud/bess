# Module map

Source: `.agent/graph/module-inventory.json` and `.agent/graph/import-graph.json`,
generated 2026-08-03 from `dev/bess-calc` (`549e01c`). Regenerate via
`npm run architecture:generate` (from `bess-calc/`) before relying on file
lists after a structural change.

## Layers

```
React SPA (src/App.tsx, src/components/)
        |
        | (also imports engine/ directly — see note below)
        v
Express API (server/routes/*.ts, mounted under /api/v1)
        |
        v
Domain modules (src/engine, src/battery, src/tariff, src/optimisation, src/import)
        |
        v
Persistence (server/lib/prisma.ts -> Prisma Client -> PostgreSQL)
```

**This is not a strict layered call chain.** `src/App.tsx` imports
`src/engine/*` directly for the client-side/stateless simulation path; the
Express layer is a *second*, independent consumer of the same domain
modules for the persistence-backed path. See
[`execution-flows.md`](execution-flows.md) for both paths traced explicitly.

## Modules (verified file lists)

### `src/` (frontend + shared domain modules)

| Module | Files | Role |
|---|---|---|
| `src/engine` | `dispatchEngine.ts`, `financialEngine.ts`, `legacyEngine.ts`, `presetProfiles.ts`, `validationEngine.ts` | Simulation, financial metrics, validation, preset scenarios. Each file's only internal dependency is `src/types/bess.ts` (verified — see the note in `CURRENT_CODE_ARCHITECTURE.md`). |
| `src/battery` | `batteryLibrary.ts`, `batteryModel.ts`, `cycleCounting.ts`, `degradationModel.ts`, `index.ts` | Battery capacity/degradation/cycle-count model. Self-contained; not currently imported by `src/engine/`. |
| `src/tariff` | `billingDemand.ts`, `demandCharges.ts`, `dispatchAdapter.ts`, `energyCharges.ts`, `exportRules.ts`, `index.ts`, `tariffEngine.ts`, `taxesAndDuties.ts`, `types.ts`, `validation.ts` | Tariff calculation (energy/demand charges, taxes, export rules). `tariffEngine.ts` composes the other tariff files. |
| `src/optimisation` | `comparison.ts`, `heuristicDispatch.ts`, `index.ts`, `lpModel.ts`, `optimisedDispatch.ts`, `types.ts` | LP (`lpModel.ts`, via `javascript-lp-solver`) vs. heuristic dispatch, compared in `comparison.ts`. `optimisedDispatch.ts` is the module that actually imports both `lpModel.ts` and `heuristicDispatch.ts`. |
| `src/import` | `cadence.ts`, `csvImporter.ts`, `errorReport.ts`, `index.ts`, `rowValidation.ts`, `timestampUtils.ts`, `toEngineIntervals.ts`, `types.ts` | CSV import pipeline: parse -> validate rows -> normalize cadence/timestamps -> convert to engine interval input. |
| `src/components` | `ExportReportModal.tsx`, `Header.tsx`, `IntervalSimulation.tsx`, `LegacyComparisonModal.tsx`, `QuickEstimateWizard.tsx`, `ResultsDashboard.tsx`, `ScenarioSensitivity.tsx` | React UI. All import `src/types/bess.ts`; none contain calculation logic (per `IMPLEMENTATION_STATUS.md`). |
| `src/types` | `bess.ts` | Shared TypeScript types — the single most-imported module in the graph (imported by nearly every engine, tariff, import, and component file, plus two server routes). Treat changes here as high blast-radius. |

### `server/` (Express API)

| Module | Files | Role |
|---|---|---|
| `server/routes` | `datasets.ts`, `health.ts`, `importValidate.ts`, `optimisation.ts`, `projects.ts`, `scenarios.ts`, `simulation.ts`, `simulations.ts`, `tariff.ts` | HTTP handlers, one file per resource. `simulation.ts` (singular, stateless) and `simulations.ts` (plural, Prisma-backed) are distinct routes — see `execution-flows.md`. |
| `server/middleware` | `correlationId.ts`, `errorHandler.ts`, `requestLogger.ts` | Cross-cutting request handling, wired in `server/app.ts`. |
| `server/lib` | `errors.ts`, `logger.ts`, `prisma.ts`, `version.ts` | Prisma client singleton, structured errors, logging, build version. |

`server/app.ts` and `server/index.ts` sit above these directories and are
listed individually rather than as a "module" — `app.ts` wires every route
and middleware together (see its full import list in
`.agent/graph/import-graph.json`); `index.ts` is the process entrypoint.

## High blast-radius files

From the import graph, these files are imported by the largest number of
other files and warrant extra care:

1. **`src/types/bess.ts`** — imported by all five `src/engine/*` files, most
   `src/components/*.tsx` files, `src/import/toEngineIntervals.ts`,
   `src/tariff/dispatchAdapter.ts`, and `server/routes/simulation.ts` /
   `simulations.ts`. A shape change here ripples across the entire app.
2. **`server/app.ts`** — imported by every `server/__tests__/*.test.ts` file
   and `server/index.ts`; it is the single wiring point for all routes and
   middleware.
3. **`src/engine/dispatchEngine.ts`** — imported by `src/App.tsx` (client
   path) and both `server/routes/simulation.ts` and
   `server/routes/simulations.ts` (server path) — any change here affects
   three independent call sites.
