# Repository summary

Quick orientation. For depth, see `architecture/`.

## What this is

A BESS (Battery Energy Storage System) ROI/design calculator: a React SPA
and Express API sharing a TypeScript calculation engine (dispatch
simulation, tariff pricing, financial metrics, LP/heuristic optimisation),
with optional PostgreSQL persistence via Prisma for reproducible, auditable
simulation runs.

The entire runtime is under `bess-calc/`. Root-level `docs/` is
design/roadmap material — some of it (`BESS_SYSTEM_ARCHITECTURE.md`,
`OPTIMISATION_ENGINE_DESIGN.md`, the product strategy doc) describes a
future target state, not current behavior. `docs/database/DATABASE_DESIGN.md`
and `docs/development/IMPLEMENTATION_STATUS.md` are accurate and current.
See `docs/architecture/CURRENT_CODE_ARCHITECTURE.md` for the as-built
description.

## Where things live

- `bess-calc/src/` — React SPA + shared calculation engine (engine, battery,
  tariff, optimisation, import, components, types)
- `bess-calc/server/` — Express API (routes, middleware, lib)
- `bess-calc/prisma/` — Prisma schema + migrations
- `.agent/` — this directory: machine-derived + hand-written repo
  intelligence for agents
- `docs/` — design docs, some current, some aspirational (see above)

## Running things

All commands run from `bess-calc/`:

```bash
npm ci
npm test              # vitest run — src/**/*.test.ts + server/**/*.test.ts
npm run lint          # tsc --noEmit for both the app and server tsconfigs
npm run build         # tsc + vite build (frontend)
npm run build:server  # tsc check + tsup (backend)
npm run dev           # vite dev server
npm run dev:server    # tsx watch server/index.ts
npm run architecture:generate  # regenerate .agent/graph/ from source
npm run architecture:check     # dependency-cruiser: fails on forbidden deps
```

Persistence-route tests need a real Postgres — see
`server/__tests__/persistenceTestSetup.ts` and
`.github/workflows/ci.yml` for how CI provisions one. Stateless-route and
engine tests need no database.

## Conventions to know before editing

- One battery per simulated interval — do not introduce a model that
  double-counts a single battery's action across overlapping categories
  (see `docs/development/IMPLEMENTATION_STATUS.md`'s "Rule 2" double-counting
  fix for the historical bug this guards against).
- Calculation logic stays in `bess-calc/src/engine/` (and its sibling
  `battery/`, `tariff/`, `optimisation/`, `import/` modules), separate from
  React UI — see [`architecture-decisions.md`](../architecture/architecture-decisions.md#1-engine-modules-are-framework-independent-by-design).
  `npm run architecture:check` now enforces this mechanically.
- State units, assumptions, boundaries, and data provenance for any
  calculation change (per `bess-calc/CLAUDE.md`).
- Add or update focused tests for behavior changes, including boundary
  cases.
