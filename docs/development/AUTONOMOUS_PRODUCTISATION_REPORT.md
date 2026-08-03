# Autonomous productisation session report

Branch: `feature/productisation-platform-workflow` (from `dev/bess-calc` @ `549e01c`)
Session date: 2026-08-03

## Context correction that shaped this session

The original brief assumed `dev/bess-calc` had no backend and needed one built
from scratch. Before this session started, `main` had already been merged into
`dev/bess-calc` (`549e01c`), bringing in a full Express/Prisma backend, CSV
import pipeline, tariff/optimisation engines, and a battery SOH model - all
real and tested. This session's job was therefore verification + the genuine
remaining gaps, not a rebuild. Every gap below was independently re-verified
against the code, not assumed from the stale brief.

## What was completed

### Priority 1 - frontend wired to the real backend
- `bess-calc/src/api/` (`client.ts`, `types.ts`, `projects.ts`, `datasets.ts`,
  `scenarios.ts`, `simulations.ts`, `index.ts`): the sole fetch boundary in the
  frontend. Typed, relative-URL only (`/api/v1/...`), surfaces the server's
  `{ error: { code, message, details, correlationId } }` envelope via
  `ApiClientError`.
- `bess-calc/src/components/ProjectWorkspace.tsx`, wired into `App.tsx` and
  `Header.tsx` as a new "Projects" tab: create/list/select a project, upload a
  CSV (import summary shown: rows, cadence, peak load, energy, solar
  contribution, engineering grade), save the config currently set on the
  Quick/Interval tabs as a named scenario against the imported dataset, run a
  real simulation via the API, view persisted results (savings, NPV, IRR, ROI,
  LCOS, payback, warnings).
- The existing Quick/Interval/Scenario/Comparison tabs are **untouched** and
  keep working fully client-side, no backend dependency - this is additive,
  not a replacement.
- `bess-calc/src/import/types.ts` + `csvImporter.ts`: added
  `peakLoadKw`/`totalLoadEnergyKwh`/`totalSolarEnergyKwh`/`solarContributionPct`
  to `ImportSummary` - these were genuinely missing from the summary shape the
  dataset import route returns, confirmed by reading `server/routes/datasets.ts`
  before adding them.
- `vite.config.ts`: dev-only proxy for `/api/v1` to `localhost:8080` so the
  frontend's relative-URL client works against `pnpm dev:server` locally.
- `src/engine/` was **not modified** for this priority - it stays pure and
  fetch-free per the architecture rule; all persistence/API logic lives in
  `server/` (pre-existing) and the new `src/api/` client.

### Priority 2 - engineering report generator
- `bess-calc/src/report/` (`types.ts`, `reportModel.ts`,
  `sensitivityAnalysis.ts`, `index.ts`): a structured JSON report model
  (`buildEngineeringReport`) - executive summary, technical design, financial
  analysis, sensitivity analysis - derived entirely from a real
  `SimulationResult`, no re-derivation or hardcoded assumptions.
- Fixed `financialEngine.ts`'s LCOS: it previously applied an undocumented
  `* 0.9` derate to lifetime discharge and only counted a flat annual `omCost`
  in the numerator (excluding charging/auxiliary energy cost). Replaced with a
  standard discounted-cost / discounted-energy LCOS using the same discount
  rate as NPV/IRR and the same per-year `omCostY` already used in the cash
  flow build. Added the missing `roiPct` field (lifetime net cash flow as % of
  CapEx - explicitly documented as distinct from IRR).
- Replaced `ScenarioSensitivity.tsx`'s hardcoded `baseNetSaving * 0.75` /
  `* 1.25` conservative/optimistic multipliers with
  `buildSensitivityMatrix()`: each scenario is a real re-run of
  `calculateFinancialMetrics` with perturbed CapEx/tariff-escalation/
  degradation inputs against the same dispatch output. Dispatch itself is
  deliberately not re-run for these three axes - none of them affect physical
  dispatch decisions under the current engine, confirmed by reading
  `dispatchEngine.ts` - so re-running it would reproduce identical numbers.
  This is distinct from Priority 4's still-outstanding scenario-vs-scenario
  comparison (independently *configured* scenarios, not perturbed financial
  assumptions on one scenario).
- PDF export: **not attempted**. No lightweight PDF library is already a
  transitive dependency, and `ExportReportModal.tsx`'s existing
  `window.print()` already honestly labels itself "Print Report" (not "Export
  PDF"). Left as-is rather than adding a heavyweight dependency to make an
  overclaim.
- Added `roiPct`/`lcoePerKwh` to `ExportReportModal.tsx`'s copy-to-clipboard
  text and summary tiles.

### Priority 5 - CI / Docker verification (partially, see below)
- **Real bug found and fixed**: removing the stale `package-lock.json` (dead
  weight now that pnpm is declared) broke two things that still referenced it:
  - `.github/workflows/bess-calc.yml` ran `npm ci` against a lockfile that no
    longer exists. This is a stale duplicate of the actively-maintained
    `.github/workflows/ci.yml` (which already has an ephemeral Postgres
    service, Prisma migrations, the full test suite including persistence
    tests, and a Docker build+health-check job - i.e. gap #8 from the original
    brief was **already fixed** by whoever authored `ci.yml`). Attempted to
    delete `bess-calc.yml` outright; that action was blocked by this
    environment's permission classifier (deleting CI workflow files needs
    human sign-off), so it was fixed in place (converted to pnpm) instead,
    with a comment for a human reviewer to decide whether to retire it in
    favour of `ci.yml`.
  - `bess-calc/Dockerfile` used `npm ci` in all three stages
    (deps/build/runtime) and the runtime stage's
    `COPY --from=build node_modules/.prisma` assumed a Prisma output layout
    that Prisma 6 + pnpm doesn't actually produce (the generated client lives
    inside `node_modules/@prisma/client`, nested under pnpm's
    `node_modules/.pnpm/`, not a separate top-level `.prisma/` folder) - that
    COPY was silently copying nothing useful. Migrated all stages to pnpm and
    replaced the targeted copy with copying the build stage's full
    already-generated `node_modules` + `pnpm prune --prod`, which is
    layout-agnostic.
  - **Verified locally** (Docker Desktop was running in this environment):
    `docker build` succeeds end-to-end; the container starts; `GET
    /api/v1/health` and `/api/v1/version` respond correctly; `GET /` serves
    the built frontend (200); `docker compose config` validates. Test
    container/image removed after verification.
- API integration tests (supertest) for the new `src/api/` client and a
  simulation-route reproducibility test were **not added** in this session -
  see "Remaining gaps" below.

## Deliberately NOT touched, and why

- **Priority 3 (battery SOH integration)** and **Priority 4 (scenario-vs-scenario
  comparison)**: confirmed still-real gaps (verified `financialEngine.ts` still
  uses a flat `annualDegradationPct` scalar, `src/battery/degradationModel.ts`
  is genuinely unwired), but not started. Per the brief's own guidance ("a
  working Priority 1+2 beats a half-broken 1 through 5"), the session stopped
  after fully completing and verifying Priorities 1, 2, and the CI/Docker part
  of 5, rather than half-finishing 3 and 4. Wiring SOH into dispatch changes
  engine behaviour (usable capacity shrinking with SOH) and would need care
  against `dispatchEngine.noDoubleCounting.test.ts` and the scenario tests -
  correctly scoped as its own session, not squeezed in.
- **Docker Compose full stack run** (app + a real ephemeral Postgres wired
  together end-to-end) was not attempted beyond the single-container health
  check above - the container's own health check doesn't need a DB (the
  stateless routes work without one), and standing up a second Postgres
  container plus running `prisma migrate deploy` against it was judged lower
  value than the single-container check already done, given time spent on
  Priorities 1/2.
- **Supply-chain / dependency audit** beyond what `pnpm install`'s own
  built-in lockfile policy check already reported (all installs above logged
  "Lockfile passes supply-chain policies") - not separately run.
- Root `docs/` roadmap material - untouched, per the standing repo rule.

## Package manager: pnpm, working via `npx`, not global corepack

`corepack enable` failed with `EPERM: operation not permitted, open 'C:\Program
Files\nodejs\pnpm'` (no admin rights to write the shim into `Program Files`).
`npx --yes pnpm@11.18.0 <command>` works identically without needing a global
install or writing outside the project, and was used for every `pnpm`
invocation in this session (install, test, lint, build, prisma generate).
Deleted the stale `package-lock.json` (see commit `dc5b92c`) now that
`pnpm-lock.yaml` is the real lockfile - this surfaced the CI/Dockerfile bugs
above, both now fixed.

## Database

No new Prisma migrations were authored. `DATABASE_URL` was never set in this
environment (no staging/prod access, and no local Postgres was started for
this session's Priority 1/2 work) - the persistence-backed server tests
(`projects.test.ts`, `scenarios.test.ts`, `datasets.test.ts`,
`simulations.test.ts`) self-skipped throughout, exactly as designed
(`server/__tests__/persistenceTestSetup.ts`'s `hasDatabaseUrl` guard). This
was confirmed by reading that guard and by the consistent "X skipped" test
output below - not assumed.

## Verified command output (real, from this session, not paraphrased)

```
$ npx --yes pnpm@11.18.0 test
 Test Files  32 passed | 4 skipped (36)
      Tests  221 passed | 20 skipped (241)

$ npx --yes pnpm@11.18.0 lint
$ tsc --noEmit && tsc -p server/tsconfig.json --noEmit
(clean, no output = no errors)

$ npx --yes pnpm@11.18.0 build:all
✓ built in 5.65s   (vite build, frontend)
ESM server-dist/index.js     114.31 KB
ESM ⚡️ Build success in 41ms   (tsup, server)
```

Docker (verified locally, Docker Desktop was running):
```
$ docker build -t bess-calculator:local-verify --build-arg GIT_COMMIT_SHA=<sha> .
...DONE 25.5s (multi-stage build succeeded)

$ docker run -d -p 18080:8080 bess-calculator:local-verify
$ curl http://127.0.0.1:18080/api/v1/health
{"status":"ok","uptimeSeconds":3.76}
$ curl http://127.0.0.1:18080/api/v1/version
{"appVersion":"0.0.0-unknown","calculationEngineVersion":"1.0.0","gitCommitSha":"...","nodeVersion":"v22.14.0"}
$ curl -o /dev/null -w "%{http_code}" http://127.0.0.1:18080/
200
```
(test container and image removed after verification)

## Deployment status

**Local-only, as scoped.** No remote deploy was attempted or should be inferred
from this report. A real deploy would need: `DATABASE_URL` pointed at a real
Postgres (staging/prod credentials this session never had or touched),
`prisma migrate deploy` run against it (see
`docs/database/MIGRATION_GUIDE.md`'s documented pattern - not `migrate dev`,
which needs shadow-DB rights this project's admin role doesn't have), the
Docker image pushed to a registry, and `.github/workflows/ci.yml`'s existing
Postgres-service + Docker-build job is already the correct CI gate for that -
no changes needed there beyond what's in this branch.

## Remaining gaps (explicitly out of scope for this session)

1. **Battery SOH not integrated into dispatch/financial engine** (Priority 3).
   `src/battery/degradationModel.ts` is tested standalone but not wired into
   `dispatchEngine.ts`/`financialEngine.ts`. `financialEngine.ts`'s
   `effectiveCapacityPct` is still a flat scalar.
2. **No battery catalogue extension** (Priority 3, secondary) -
   `src/battery/batteryLibrary.ts` not reviewed/extended this session.
3. **No independently-configured scenario-vs-scenario comparison** (Priority 4)
   - only the sensitivity-matrix re-run (Priority 2, same scenario, perturbed
   financial assumptions) was added this session.
4. **No frontend E2E/browser test** (Playwright/Cypress) - not added.
5. **No API integration tests (supertest) for the new `src/api/` client**, and
   **no simulation-route reproducibility test** - not added this session;
   the server-side routes it calls already have their own supertest coverage
   (`server/__tests__/{projects,scenarios,datasets,simulations}.test.ts`), but
   the client layer itself (`src/api/`) has no test coverage yet.
6. **MPC, AI-based optimisation, digital twin, tariff crawler integration** -
   explicitly out of scope, not started, no code claims they exist.
7. `.github/workflows/bess-calc.yml` vs `ci.yml` duplication - fixed in place
   rather than resolved; a human should decide whether to retire the older one.

## Morning review checklist (prioritised)

1. **First files to look at**: `bess-calc/src/api/client.ts` (error handling
   contract), `bess-calc/src/components/ProjectWorkspace.tsx` (the new
   end-to-end workflow), `bess-calc/src/engine/financialEngine.ts` (LCOS/ROI
   math change - re-derive by hand against the doc comments if in doubt),
   `bess-calc/Dockerfile` (pnpm migration + prisma copy fix).
2. **First workflow to click through**: start `pnpm dev:server` (needs a local
   `DATABASE_URL` - a docker Postgres works) and `pnpm dev`, then use the new
   "Projects" tab: create a project, upload a small CSV, save a scenario, run
   a simulation, confirm the results tile numbers make sense against the
   Quick/Interval tabs' numbers for the same inputs.
3. **Known risks**: the LCOS math change is a real behavioural change to a
   number that may already appear in a customer-facing report or sales
   conversation - re-verify the new discounted-cost/discounted-energy
   definition is what's wanted before relying on it commercially. The
   `bess-calc.yml`/`ci.yml` CI duplication should be resolved (retire one)
   rather than left as two workflows running similar checks.
4. **Recommended next sprint**: Priority 3 (battery SOH integration into
   dispatch/financial engine) is the natural next step - it's well-scoped,
   has existing standalone tests to build from, and was the reason this
   session stopped where it did rather than half-finishing it. Priority 4
   (scenario comparison) and API client test coverage (gap 5 above) are the
   next two after that.
