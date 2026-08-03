# Execution flows

Verified against source on 2026-08-03 (`dev/bess-calc`, `549e01c`). All
routes are read directly from `bess-calc/server/routes/*.ts` and mounted
under `/api/v1` by `server/app.ts` — see that file for the exact mount
order and for the stateless/persistence split (`AppOptions.prismaClient`).

## Two independent simulation paths

**Path A — client-side, stateless, not persisted** (interactive quick-mode
UI):

```
src/App.tsx (user edits config in the browser)
  -> src/engine/validationEngine.ts  validateBessConfig()
  -> src/engine/dispatchEngine.ts    runIntervalDispatch()
  -> src/engine/financialEngine.ts   calculateFinancialMetrics()
  -> src/engine/validationEngine.ts  validateSimulationResult()
  -> rendered directly in React state, nothing written to a database
```

**Path B — CSV-driven, server-side, persisted** (the mission's requested
"CSV Upload -> ... -> Report" flow):

```
CSV Upload
  POST /api/v1/datasets/import  (server/routes/datasets.ts)
    -> src/import (importIntervalCsv: parse -> validate rows -> normalize cadence/timestamps)
    -> Prisma: creates IntervalDataset + bulk-inserts IntervalRecord rows (batches of 5,000)
       |
       v
Scenario creation
  POST /api/v1/projects/:projectId/scenarios  (server/routes/scenarios.ts)
    -> Prisma: creates Scenario, referencing the IntervalDataset by id
       |
       v
Simulation run
  POST /api/v1/simulations  { scenarioId }  (server/routes/simulations.ts)
    -> Prisma: load Scenario + its IntervalRecords
    -> src/import/toEngineIntervals.ts   (interval rows -> engine's interval input shape,
                                          using the Scenario's tariffConfig for TOU windows)
    -> src/engine/validationEngine.ts    validateBessConfig()
    -> src/engine/dispatchEngine.ts      runIntervalDispatch()      [Dispatch Engine]
    -> src/engine/financialEngine.ts     calculateFinancialMetrics() [Financial Engine]
    -> src/engine/validationEngine.ts    validateSimulationResult()
    -> Prisma: creates SimulationRun (status pending -> running -> completed/failed,
               inputSnapshot = full frozen copy of every input actually consumed)
    -> Prisma: creates SimulationResult (savingsBreakdown/technicalResult/financialResult/warnings as JSON)
       |
       v
Report
  GET /api/v1/simulations/:id/results  (server/routes/simulations.ts)
    -> Prisma: SimulationRun.findUnique({ include: { result: true } })
```

Note: the mission's illustrative flow names a distinct "Tariff Application"
and "Optimisation" stage between "Interval Normalisation" and "Dispatch
Engine". In this codebase, tariff application is folded into
`toEngineIntervals.ts` (using `tariffConfig`) and into `dispatchEngine.ts`
itself (tariff-rate lookups during dispatch), and the LP/heuristic
optimisation modules (`src/optimisation/`) are **not** currently called from
this persisted flow — `POST /api/v1/optimisation/run` is a separate,
independent, stateless endpoint (see below), not a stage of the persisted
simulation pipeline. Verify this against `server/routes/simulations.ts`
before assuming otherwise.

## API map

All paths below are relative to `/api/v1`.

| Route | Persisted? | Input | Output | Service call | DB entities touched |
|---|---|---|---|---|---|
| `GET /health` | No | — | `{ status: 'ok' }`-shape health payload | `server/routes/health.ts` | — |
| `GET /version` | No | — | build/version info | `server/lib/version.ts` | — |
| `POST /tariff/calculate` | No | `{ tariff: TariffDefinition, intervals: BillingInterval[] }` (max 200,000 intervals) | Calculated energy/demand charges, taxes | `src/tariff/index.ts` (`tariffEngine.ts`) | — |
| `POST /import/validate` | No | Raw CSV/import request (validate-only, no persistence) | Validation summary/warnings/row errors | `src/import/index.ts` | — |
| `POST /simulation/run` | No (stateless — this is Path A's server-callable equivalent, singular route name) | `{ system, tariff, diesel, solar, financial, intervals: IntervalRecord[] (max 200,000), dispatchPriorities, intervalMinutes, mode }` | `{ mode, confidenceGrade, savings, technical, financial, warnings, assumptions, intervals }` | `dispatchEngine.ts` -> `financialEngine.ts` -> `validationEngine.ts` | — |
| `POST /optimisation/run` | No | `{ intervals, battery: BatteryConfig, options }` (max 20,000 intervals) | LP/heuristic dispatch comparison result | `src/optimisation/index.ts` | — |
| `GET /projects` | Yes | — | `Project[]`, newest first | Prisma | `projects` |
| `POST /projects` | Yes | `{ name, customerName?, location? }` | Created `Project` | Prisma | `projects` |
| `GET /projects/:id` | Yes | — | `Project` or 404 `PROJECT_NOT_FOUND` | Prisma | `projects` |
| `POST /projects/:projectId/scenarios` | Yes | `{ name, intervalDatasetId?, batteryConfig, tariffConfig, solarConfig, generatorConfig, financialConfig, dispatchPriorities }` (config objects accepted as opaque records, validated later at simulation time) | Created `Scenario` | Prisma | `projects` (FK check), `interval_datasets` (FK check if provided), `scenarios` |
| `GET /scenarios/:id` | Yes | — | `Scenario` or 404 | Prisma | `scenarios` |
| `POST /datasets/import` | Yes | `{ projectId, csvText (max 15MB), tariffTimezone, mode?, allowIrregular?, sourceFile? }` | `{ datasetId, summary, warnings, rowErrors }` | `src/import/index.ts` (`importIntervalCsv`) + Prisma | `projects` (FK check), `interval_datasets`, `interval_records` (bulk insert, 5,000/batch) |
| `POST /simulations` | Yes | `{ scenarioId }` | `{ simulationId, status, confidenceGrade, confidenceGradeReason }` | `dispatchEngine.ts` -> `financialEngine.ts` -> `validationEngine.ts` + Prisma | `scenarios`, `interval_datasets`, `interval_records` (read); `simulation_runs`, `simulation_results` (write) |
| `GET /simulations/:id` | Yes | — | `SimulationRun` or 404 | Prisma | `simulation_runs` |
| `GET /simulations/:id/results` | Yes | — | `SimulationResult` or 404 (`RESULTS_NOT_READY` if run hasn't completed) | Prisma | `simulation_runs`, `simulation_results` |

`POST /simulation/run` (singular) and `POST /simulations` (plural) are
**different routes with overlapping names** — see the "suspicious coupling"
note in [`dependency-map.md`](dependency-map.md).

## Database map

See `bess-calc/prisma/schema.prisma` for the authoritative field list;
this is the relationship shape only.

```
Project
  |-- 1:N --> Scenario --------------------> intervalDatasetId (nullable FK)
  |-- 1:N --> IntervalDataset
                |-- 1:N --> IntervalRecord
                |-- 1:N --> Scenario (reverse of the FK above)

Scenario
  |-- 1:N --> SimulationRun
                |-- 1:1 --> SimulationResult
```

Cascade deletes: `Project -> Scenario`, `Project -> IntervalDataset`,
`IntervalDataset -> IntervalRecord`, `Scenario -> SimulationRun`,
`SimulationRun -> SimulationResult` (all `onDelete: Cascade` per
`schema.prisma`). Indexes: `Scenario.projectId`, `IntervalDataset.projectId`,
`IntervalRecord.(datasetId, timestamp)`, `SimulationRun.scenarioId`,
`SimulationRun.status`.

Large nested engine input/output shapes (`batteryConfig`, `tariffConfig`,
`solarConfig`, `generatorConfig`, `financialConfig`, `dispatchPriorities` on
`Scenario`; `inputSnapshot` on `SimulationRun`; `savingsBreakdown`,
`technicalResult`, `financialResult`, `warnings` on `SimulationResult`) are
stored as `Json` columns rather than normalized tables — a deliberate v1
trade-off documented in `schema.prisma`'s header comment and
`docs/database/DATABASE_DESIGN.md`.
