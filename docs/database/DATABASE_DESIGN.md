# BESS Calculator — Database Design (v1)

## Purpose

Move the calculator from stateless request/response to a persistent,
auditable platform: a customer assessment (`Project`) can hold multiple
design cases (`Scenario`), each simulated against an interval dataset
(`IntervalDataset`/`IntervalRecord`), producing reproducible, retrievable
runs (`SimulationRun`/`SimulationResult`).

This is additive to the existing stateless engine — `src/engine/`,
`src/tariff/`, `src/optimisation/`, `src/import/` are unchanged. The
persistence layer is a new consumer of those modules, not a replacement.

## Stack

- **PostgreSQL** — already provisioned, not created by this project. A
  database named `bess` exists on both:
  - Staging: `prjx1`, standalone Postgres, reached locally via an existing
    SSH tunnel on `localhost:5433`.
  - Prod: `prjx6`, a Patroni HA cluster, reached via HAProxy's primary
    endpoint (port 5000) through an existing SSH tunnel on `localhost:15433`.
    Always go through HAProxy — never connect to a Patroni node directly,
    since the primary can fail over to a different node at any time.
- **Prisma ORM 6.19.3** (pinned to the 6.x line deliberately — Prisma 7
  changed the datasource/config model significantly (`prisma.config.ts`,
  mandatory driver adapters, a new `output` path for the generated client)
  and added complexity with no benefit for this project's needs; 6.x keeps
  the well-documented `datasource { url = env("DATABASE_URL") }` pattern and
  generates to the conventional `@prisma/client` location).

## Entities

| Model | Purpose | Key fields kept as real columns | What's JSON |
|---|---|---|---|
| `Project` | A customer assessment | name, customerName, location | — |
| `Scenario` | One BESS design case within a project | name, FKs to project/dataset | batteryConfig, tariffConfig, solarConfig, generatorConfig, financialConfig, dispatchPriorities |
| `IntervalDataset` | An imported load profile | timezone, intervalMinutes, startTime, endTime | metadata (ImportSummary) |
| `IntervalRecord` | One imported interval row | timestamp, loadKw, loadKva, solarKw, dgKw, powerFactor | — |
| `SimulationRun` | One reproducible engine invocation | engineVersion, status, timestamps | inputSnapshot (full input the engine actually consumed) |
| `SimulationResult` | Output of a run | peakReductionKw, energySavings, demandSavings, arbitrageSavings, totalSavings, irr, npv | savingsBreakdown, technicalResult, financialResult, warnings |

### Why JSON columns, not full normalization

`SimulationResult` (see `src/types/bess.ts`) is a large, nested, evolving
type — `SavingsBreakdown`, `TechnicalResult`, `FinancialResult` (with a
per-year `AnnualCashFlow[]` array), and the full simulated `IntervalRecord[]`
trace. Fully normalizing all of this into relational tables today would:

- require a schema migration every time the calculation engine's output
  shape changes (which has happened multiple times per the engine's own
  test history), coupling database schema changes to engine iteration speed;
- add substantial join complexity for data that is always read back as one
  cohesive object, never queried by its individual nested fields.

v1's rule: **top-line, queryable fields become real columns** (so listing
scenarios/runs, sorting by savings, and filtering by status doesn't require
deserializing JSON); **everything else is stored as `Json`** exactly as the
engine produced it, so a `SimulationResult` can always be reconstructed
byte-for-byte from a `SimulationRun`/`SimulationResult` pair. Revisit
normalization if/when specific fields need indexed querying beyond what's
already promoted to columns.

## Relationships

```
Project 1---* Scenario
Project 1---* IntervalDataset 1---* IntervalRecord
Scenario *---1 IntervalDataset (optional; quick-mode scenarios may have none)
Scenario 1---* SimulationRun 1---1 SimulationResult
```

## Reproducibility and auditability

Every `SimulationRun` stores:

- `engineVersion` — `CALCULATION_ENGINE_VERSION` from `server/lib/version.ts`,
  the same constant already used elsewhere in the server.
- `inputSnapshot` — a complete, immutable copy of every input the engine
  consumed (system/tariff/diesel/solar/financial/dispatchPriorities/
  intervalMinutes/mode), captured at run time. This is deliberately a copy,
  not a live reference back to the (mutable) `Scenario` row — if the
  scenario is edited later, past runs remain reproducible from their own
  snapshot.
- `startedAt`/`completedAt`/`status`/`errorMessage` — when it ran and
  whether it succeeded.

`SimulationResult.warnings` carries the same `ValidationWarning[]` the
stateless API already returns, so a stored run has the identical audit
trail as a live one.

## Access pattern / least privilege

Two credential pairs exist per environment (`bess-calc/.env`,
`DB_STG_*`/`DB_PROD_*`):

- `*_ADMIN_USER`/`*_ADMIN_PASSWORD` — used only for running migrations
  (`prisma migrate deploy`), never wired into the running application.
- `*_USER`/`*_PASSWORD` — the application's runtime `DATABASE_URL`, used by
  the Express server for all normal CRUD/query operations.

See `MIGRATION_GUIDE.md` for exactly how these are composed and used.
