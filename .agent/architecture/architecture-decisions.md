# Architecture decisions

Decisions actually found and cited in source, not inferred. Each entry
names the file where the decision is recorded so it can be re-verified
rather than trusted at face value.

## 1. Engine modules are framework-independent by design

**Where recorded**: `bess-calc/vitest.config.ts` comment ("the engine layers
are designed to be usable independent of React... tests run in plain Node,
no DOM environment required"); `docs/architecture/CALCULATION_ENGINE_DESIGN.md`.

**What it means**: `src/engine/`, `src/battery/`, `src/tariff/`,
`src/optimisation/`, `src/import/` must not import React, Express, or
`@prisma/client`. Verified as currently true via `.dependency-cruiser.cjs`'s
`engine-no-express` rule (`npm run architecture:check` passes as of
2026-08-03). This is what lets the same dispatch/financial/validation code
run both client-side (`src/App.tsx`) and server-side (`server/routes/simulation.ts`,
`server/routes/simulations.ts`) — see [`execution-flows.md`](execution-flows.md).

## 2. Stateless routes vs. Prisma-backed routes are structurally separated

**Where recorded**: `server/app.ts`, the `AppOptions.prismaClient` JSDoc
comment: "The pre-existing stateless routes (simulation/run, tariff/calculate,
optimisation/run) never touch this [Prisma client] - they have no DB
dependency regardless of whether this option is provided."

**What it means**: `health`, `tariff`, `importValidate`, `simulation`, and
`optimisation` routers are plain `Router()` exports with no constructor
arguments. `projects`, `scenarios`, `datasets`, and `simulations` routers are
all factory functions (`createXRouter(prisma)`) that require an injected
`PrismaClient`. Tests exploit this: `server/__tests__/persistenceTestSetup.ts`
stands up a real ephemeral Postgres only for the persistence-route tests;
the stateless-route tests need no database.

## 3. Prisma schema is intentionally JSON-heavy, not fully normalized

**Where recorded**: `bess-calc/prisma/schema.prisma`'s header comment: "This
is a deliberate v1 trade-off, not an oversight — full normalization of
these deeply nested, evolving engine types would require a schema migration
every time the calculation engine's output shape changes." Also
`docs/database/DATABASE_DESIGN.md`.

**What it means**: `Scenario`'s five config fields and `SimulationResult`'s
three result fields are `Json` columns. Only what needs to be queried,
joined, or indexed directly (ids, timestamps, status, top-line savings
numbers) is a real column. Do not "fix" this into a normalized schema
without first confirming the trade-off is actually being revisited — it's a
considered decision, not debt.

## 4. `SimulationRun.inputSnapshot` must be a complete, immutable copy

**Where recorded**: `prisma/schema.prisma` comment on `SimulationRun`:
"reproducibility depends on this being a complete, immutable copy, not a
reference back to the (mutable) Scenario row."

**What it means**: `server/routes/simulations.ts` builds `inputSnapshot` by
copying every field the engine actually consumed (`system`, `tariff`,
`diesel`, `solar`, `financial`, `dispatchPriorities`, `intervalMinutes`,
`mode`, plus dataset identity/record count) at the moment the run starts —
not by storing a foreign key back to `Scenario`, which could later be
edited. Do not refactor this into a `Scenario` reference without
recognizing this breaks the auditability guarantee.

## 5. `legacyEngine.ts` intentionally reproduces flawed arithmetic

**Where recorded**: `docs/development/IMPLEMENTATION_STATUS.md`, "Explicitly
not touched, and why": "intentionally reproduces flawed sales-pitch
arithmetic as a documented counter-example (Comparison tab). Left as-is."

**What it means**: `src/engine/legacyEngine.ts`'s output disagreeing with
`dispatchEngine.ts`'s output is the intended behavior of the Comparison tab
(`src/components/LegacyComparisonModal.tsx`), not a bug to fix.

## 6. No mechanical enforcement of the engine/framework boundary before this pass

**Where recorded**: this repository-intelligence pass itself
(`bess-calc/.dependency-cruiser.cjs`, added 2026-08-03). Before this, decision
#1 above was convention-only — nothing failed if it were violated.

**What it means**: `npm run architecture:check` (dependency-cruiser,
`error`-severity `engine-no-express` rule) is now the mechanical check.
`.github/workflows/architecture.yml` runs it in CI. If this rule starts
failing, that is a real architecture violation to fix, not a check to
delete — unless the underlying design decision (#1) is being deliberately
revisited, in which case update this file too.
