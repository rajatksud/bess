# BESS repository

## Objective

Build a transparent BESS design and decision-support platform. The current
runtime is the React/Vite calculator in `bess-calc/`; the root `docs/` tree is
design and roadmap material, not implemented backend functionality.

## Working rules

- Inspect the smallest relevant file set before editing.
- Keep calculation logic in `bess-calc/src/engine/`, separate from React UI.
- Preserve the one-battery-per-interval model and do not double-count savings.
- State units, assumptions, boundaries, and data provenance for calculation changes.
- Add or update focused tests for behaviour changes, including boundary cases.
- The API server (`bess-calc/server/`, Express 5 + Zod), PostgreSQL persistence
  (`bess-calc/prisma/`, Prisma), CSV import (`bess-calc/src/import/`), and an
  LP/MILP-assisted dispatch optimiser (`bess-calc/src/optimisation/`) DO exist
  in this repository and are tested (see `bess-calc/server/__tests__/` and the
  relevant `src/*/__tests__/` directories) - do not claim otherwise. What does
  NOT exist: a real MPC controller, an AI/ML-based optimiser, or a digital
  twin. Battery SOH (`bess-calc/src/battery/degradationModel.ts`) exists and is
  tested standalone but is NOT yet wired into `dispatchEngine.ts` or
  `financialEngine.ts` - `financialEngine.ts` still uses a flat
  `annualDegradationPct` scalar, not the real SOH model. Verify current status
  against the code before stating what is/isn't wired up; this file is a
  starting point, not a substitute for reading the code.
- Do not modify unrelated documentation or roadmap phases.
- Never change production data or credentials.

## Commands

Run from `bess-calc/`. The declared package manager is pnpm (see
`package.json` `"packageManager"`); if a global `pnpm` isn't installed and
`corepack enable` can't write its shim (e.g. no admin rights to
`Program Files`), `npx --yes pnpm@<version-from-package.json>` works
identically without a global install:

```text
pnpm install
pnpm test
pnpm lint
pnpm build
```

Persistence-backed server tests (`server/__tests__/{projects,scenarios,datasets,simulations}.test.ts`)
self-skip when `DATABASE_URL` is unset, so `pnpm test` still runs clean with
no database configured - only `.github/workflows/ci.yml`'s ephemeral Postgres
service actually exercises them. Never point `DATABASE_URL` at staging/prod;
use a local ephemeral Postgres (e.g. via Docker) if you need real DB-backed
verification, and never run the `db:migrate:staging`/`db:migrate:prod` scripts
outside of a deliberate, human-approved deploy.

For a focused change, run the relevant Vitest file first, then the full suite.

## Task protocol

1. Identify the affected files and direct dependencies.
2. Inspect only those files and the relevant architecture rule.
3. Implement the smallest complete change.
4. Run focused tests, then lint/build when practical.
5. Report changed files, commands and results, known limitations, and the next action.

Keep handoffs under 250 words. Preserve only the current task, changed files,
failures, constraints, and next action when compacting context.
