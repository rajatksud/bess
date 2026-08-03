# Next Engineering Sprint Plan

Branch: `feature/bess-engineering-completion` (from `dev/bess-calc` @ `a5e82fc`)
Written before any code change, from a full read of the modules named below.

---

## 1. Current architecture (verified, not assumed)

### Runtime layers

| Layer | Location | Notes |
|---|---|---|
| UI | `src/App.tsx`, `src/components/` | `App.tsx` runs the whole engine synchronously in a `useMemo` |
| Domain | `src/engine/`, `src/battery/`, `src/tariff/`, `src/optimisation/`, `src/import/`, `src/report/` | pure functions, no I/O |
| API | `server/` (Express 5, Zod, Prisma) | `createXRouter(prisma)` DI factories, `{ result, correlationId }` envelope |
| Persistence | `prisma/schema.prisma` | Project → Scenario → SimulationRun → SimulationResult, IntervalDataset → IntervalRecord |

### The single-balance dispatch engine

`src/engine/dispatchEngine.ts` (449 lines) is one function doing four jobs:

1. **Pre-computation** (lines 48–148): efficiency, SOC window, `preBessGridImportSeries`, `peakBeforeKw/Kva`, `targetPeakKw`.
2. **Per-interval priority loop** (152–325): picks *one* `bessAction` per interval and accumulates
   per-category energy (`totalDgDisplacedKwh`, `totalSolarStoredKwh`, `totalArbitrageDischargedKwh`,
   `totalArbitrageChargedKwh`, `totalGridChargedKwh`).
3. **Savings + technical aggregation** (327–445): turns those accumulators into `SavingsBreakdown`
   and `TechnicalResult`.
4. Returns everything in one object.

**Rule 2 (no double counting) is enforced entirely by step 2's one-tag-per-interval attribution.**
Step 3 only ever reads the per-category accumulators, never the aggregate `totalDischargedKwh`,
for anything monetised.

### Verification of the findings in the brief

All four were checked against the code and are **confirmed**:

| Claim | Status | Evidence |
|---|---|---|
| `src/battery/` is dead code | **Confirmed** | `rg` finds no import of `src/battery` outside `src/battery/__tests__/` |
| Two unlinked battery types, no adapter | **Confirmed** | `BatteryModelConfig` (8 fields) vs `BessSystemInput` (14 fields); no conversion anywhere |
| `estimateDegradation` is single-period, returns no kWh | **Confirmed** | `degradationModel.ts:68-99`, `DegradationResult` has `sohPct` only |
| `effectiveCapacityKwh` is **reported-only** | **Confirmed** | Defined `dispatchEngine.ts:51`, used exactly once more, at line 444 (`deliverableCapacityKwh`). It constrains nothing. |

The **real** energy bound is `dispatchEngine.ts:164-166`:

```ts
const currentStoredKwh = (currentSocPct / 100) * system.ratedEnergyKwh;
const minStoredKwh     = (minUsableSocPct / 100) * system.ratedEnergyKwh;
const maxStoredKwh     = (maxUsableSocPct / 100) * system.ratedEnergyKwh;
```

…with the SOC write-back at line 255: `currentSocPct = (nextStoredKwh / system.ratedEnergyKwh) * 100`.
Injecting SOH anywhere else changes a displayed number and nothing physical.

Three call sites pass 8 positional args (`src/App.tsx:189`, `server/routes/simulation.ts:75`,
`server/routes/simulations.ts:94`) → a 9th positional param is rejected in favour of an options object.

### Additional findings from this read (not in the brief)

- **`prisma migrate` "staging" and "prod" differ only by port.** `DB_STG_HOST === DB_PROD_HOST`
  (localhost), `DB_STG_NAME === DB_PROD_NAME`, `DB_STG_USER === DB_PROD_USER`,
  `DB_STG_ADMIN_USER === DB_PROD_ADMIN_USER`; only `DB_STG_PORT !== DB_PROD_PORT`. These are
  almost certainly two SSH-forwarded tunnels. **The identity check in Objective 5 is therefore not
  optional paranoia — it is the only thing that can tell the two apart.**
- `DATABASE_URL` (used by the test suite) resolves to the **staging** port and the **app** (non-admin)
  user. The persistence tests therefore already run for real against staging, not skipped.
- `equivalentFullCycles` is defined **twice, differently** (see Objective 4).
- `ExportReportModal.tsx:71` hardcodes `Engine Version: 2.4.0-Engineering`;
  `server/lib/version.ts:36` says `CALCULATION_ENGINE_VERSION = '1.0.0'`.

---

## 2. Gaps, in the order they will be closed

### Gap A — savings aggregation is welded into the dispatch loop

Nothing except `runIntervalDispatch` can produce a `SavingsBreakdown`. That blocks the SOH
multi-year forecast (Objective 1), the scenario comparison (Objective 2) and the LP unification
(Objective 3) simultaneously. **This is the highest-leverage change and goes first.**

### Gap B — battery domain is disconnected from the simulation

Four missing links: no config adapter, no SOC-trace bridge, no multi-year forecast, no injection
into the real energy bound.

### Gap C — no scenario-vs-scenario comparison

`src/optimisation/comparison.ts` is heuristic-vs-LP for a *single* scenario, grid-energy-cost only,
with gates (`initialSocKwh` equality, `demandChargeScopeNote` equality) that fire by construction
for two differently-configured designs. Its *pattern* is reusable; its code is not.

### Gap D — LP path cannot produce a `SavingsBreakdown`

LP output is untagged `dischargeKw`. Rule 2 is enforced by tagging. This needs a new, documented
modelling rule, not an adapter.

### Gap E — report is thin and contains two untruthful fields

`recommendedPowerKw`/`recommendedEnergyKwh` echo the user's own input; `buildEngineeringReport` has
no production consumer; OPEX breakdown, battery utilisation, SOH forecast and load-profile detail
are all absent.

---

## 3. Chosen order and design decisions

### Step 1 — `refactor(engine): extract savingsAggregator` (Gap A)

Extract `dispatchEngine.ts:327-445` into `src/engine/savingsAggregator.ts`, driven by an explicit
**attribution record** rather than by re-reading a `bessAction` string:

```ts
interface DispatchAttribution {
  dgDisplacedKwh: number;       // backup + diesel displacement
  peakShavingKwh: number;       // discharge credited with demand reduction
  arbitrageDischargeKwh: number;
  solarStoredKwh: number;
  gridChargedKwh: number;
  arbitrageChargedKwh: number;
  totalChargedKwh: number;      // physical, all categories — degradation/SOC only
  totalDischargedKwh: number;   // physical, all categories — degradation/SOC only
}
```

Rule 2 becomes a **checkable invariant** rather than a convention:
`dgDisplacedKwh + peakShavingKwh + arbitrageDischargeKwh === totalDischargedKwh`.
The heuristic produces records with exactly one non-zero discharge field (its existing tag);
the LP (Step 5) produces split records. Both are then aggregated by the *same* function.

Verification: no behaviour change; the existing five `dispatchEngine.*.test.ts` suites plus
`scenarios.test.ts` must pass untouched.

### Step 2 — `feat(battery): SOH into the simulation` (Gap B)

**2a. Adapter, canonical direction `BessSystemInput → BatteryModelConfig`.**
Rationale: `BessSystemInput` is what the UI edits, the API validates and the DB persists; it is the
system of record. `BatteryModelConfig` is a *derived engineering view* of the same asset. The reverse
direction cannot be total (it would have to invent SOC limits, aux load, project life).

`BatteryModelConfig` gains **optional** fields so no existing caller or test breaks:
`chemistry`, `usableDodPct`, `endOfLifeSohPct` (default 80), `warrantyYears`,
`averageAmbientTemperatureC` (promotes the current per-call runtime input to a config field),
`dodCycleLifeCurve` (the "degradation curve" — when present, cycle ageing interpolates the curve
instead of using a single `maxCycles`).

**2b. SOC-trace bridge.** `socTraceFromIntervals(intervals) → number[]` →
`extractHalfCycles` → `equivalentFullCycles`. Reuses `src/battery` unchanged.

**2c. Multi-year forecast.** `forecastSoh(config, annualDuty, years) → SohForecast`, chaining year N's
SOH into year N+1.

The **`sohPct` → usable kWh convention** (documented in code and in `docs/architecture/`):

```
capacityAtSohKwh(y) = ratedEnergyKwh × sohPct(y)/100      // SOH derates PHYSICAL capacity
usableEnergyKwh(y)  = capacityAtSohKwh(y) × usableDodPct/100
```

SOH and `usableDodPct` are therefore **orthogonal, applied once each** — SOH scales the physical
capacity that SOC percentages are measured against; `usableDodPct` is the reporting derate on top.
At SOH = 100 this reduces exactly to today's `effectiveCapacityKwh`, so nothing shifts by default.

**2d. Injection into dispatch.** 9th parameter is an **options object**
(`DispatchOptions { batterySohPct?: number }`), not a positional arg. It rewrites
lines 164-166 and 255 to use `healthAdjustedEnergyKwh`. With no SOH supplied the code takes a
branch that returns `system.ratedEnergyKwh` itself — not `× 1.0` — so byte-identity is structural,
not floating-point luck.

**2e. Financial engine.** Adds a 5th optional options param carrying per-year *physically simulated*
results:

```ts
interface FinancialEngineOptions {
  degradedYears?: Array<{ year, savings: SavingsBreakdown, energyDischargedKwh: number, sohPct: number }>;
}
```

**Trap 1 — the SOH-0 floor.** `estimateDegradation` floors SOH at 0; the financial engine floors
capacity at 0.5. Resolution: **one floor, one place, explicitly named and reported.**
`MIN_MODEL_VALID_CAPACITY_FACTOR = 0.5` applies identically on both paths, documented as a
*model-validity* floor (below 50% the linear-fade extrapolation is outside its range), never as a
physical claim. The forecast separately reports `endOfLifeYear` (first year SOH < `endOfLifeSohPct`)
and `modelValidityFloorBoundFromYear`, so a floored year is visible rather than silent.

**Trap 2 — LCOS double counting.** `financialEngine.ts:108` derates a *fixed*
`technical.energyDischargedKwh` by `effectiveCapacityPct`. If SOH also throttles dispatch throughput,
that is a second derate of the same physical effect. Resolution: **the two paths are mutually
exclusive by construction.** When `degradedYears` is supplied, the per-year `energyDischargedKwh`
(already degraded, because dispatch was re-run at that year's SOH) is used **raw** in the LCOS
denominator and `effectiveCapacityPct` is pinned to 1.0 for savings escalation. When it is absent,
today's flat-scalar path runs completely unchanged. Proved by two tests: (i) supplying
`degradedYears` all equal to year 1 with flat SOH reproduces the legacy path at
`annualDegradationPct = 0`; (ii) the LCOS denominator equals the sum of the supplied per-year
figures and is *not* equal to the double-derated value.

### Step 3 — `feat(scenario): comparison engine` (Gap C)

New `src/scenario/`. Per-scenario metrics: CAPEX, annual savings, peak reduction, energy arbitrage,
NPV, IRR, ROI, LCOS, payback, battery SOH. Explicit comparability gating with `reasons[]`
(the *pattern* from `optimisation/comparison.ts`, none of its code). Gates that matter for a
**design** comparison: identical interval dataset, identical tariff, identical currency, identical
discount rate and project life. Per-scenario metrics are always returned (individually valid);
only the *ranking* is withheld when not comparable.

Prerequisite, first: extract the inline run-and-persist sequence from `POST /simulations` verbatim
into `server/services/runScenarioSimulation.ts`; both the existing route and
`POST /api/v1/scenarios/compare` call it.

### Step 4 — `feat(report): enhancement` (Gap E)

Adds SOH forecast, battery utilisation, full OPEX breakdown, richer load profile. Three honest fixes:

- `recommendedPowerKw/EnergyKwh` → renamed `configuredPowerKw/EnergyKwh` with an explicit
  `sizingBasis: 'user_specified'`. No sizing optimiser exists; the field will not pretend otherwise.
- **`equivalentFullCycles` collision.** Two live definitions:
  `dispatchEngine.ts:412` (annual throughput ÷ nameplate) vs `cycleCounting.ts:68` (DoD-weighted from
  the SOC trace). Decision: the **DoD-weighted SOC-trace count is canonical for ageing**; the
  throughput ratio is retained as `throughputEquivalentFullCycles` (a *utilisation* metric). Both are
  reported side by side with their definitions, because they legitimately answer different questions.
  `TechnicalResult.equivalentFullCycles` keeps its current meaning and name (it is persisted JSON);
  the report labels it correctly.
- `buildEngineeringReport` gets a production consumer: wired into `ExportReportModal` (replacing its
  ad-hoc string) and exposed as `GET /api/v1/simulations/:id/report`. The hardcoded
  `2.4.0-Engineering` is replaced by `CALCULATION_ENGINE_VERSION`.

### Step 5 — `feat(optimisation): optimizer unification` (Gap D)

`DispatchOptimizer { optimise(input): DispatchResult }`, adapters both directions
(`IntervalRecord[]` gross-load ↔ `OptimisationInterval[]` net-load), and the **LP energy-attribution
rule**:

> Each interval's LP discharge is split across categories by a fixed cascade, each step capped by the
> physically avoidable quantity in that category for that interval:
> 1. **DG/backup** — cap = outage load (or `dgRequiredKw`). During an outage there is no grid bill,
>    so avoided diesel is the only value available.
> 2. **Peak shaving** — cap = `max(0, preBessGridImport_t − achievedBillingPeak)`. Only the energy
>    *above the finally-billed peak* changed the demand charge. Energy discharged below that line has
>    zero demand value.
> 3. **Arbitrage** — the residual, priced at the interval's import rate.
>
> Exhaustive (residual always lands in 3) and mutually exclusive (cascade), therefore
> Σcategories ≡ total discharged. Rule 2 holds by construction, and the ordering matches the
> heuristic's default priority list so the two paths agree.

Written up in `docs/architecture/`, and proved by an LP-path equivalent of
`dispatchEngine.noDoubleCounting.test.ts`.

**Explicit abort condition:** if the attribution rule cannot be made defensible, it will be
documented as a gap and *not* shipped. A documented honest gap beats a plausible wrong number.
Objective 3 is last because it is the only one whose failure mode is a subtly wrong financial model.

### Step 6 — tests, then Step 7 — gated deployment.

---

## 4. Expected files changed

**New**
```
src/engine/savingsAggregator.ts
src/battery/systemAdapter.ts
src/battery/sohForecast.ts
src/battery/socTrace.ts
src/scenario/{index,types,comparability,scenarioComparison}.ts
src/optimisation/{optimizer,adapters,lpAttribution}.ts
server/services/runScenarioSimulation.ts
docs/architecture/LP_ENERGY_ATTRIBUTION.md
docs/deployment/PRODUCTION_VERIFICATION.md
docs/development/OVERNIGHT_ENGINEERING_COMPLETION_REPORT.md
+ test files for each
```

**Modified**
```
src/engine/dispatchEngine.ts      (aggregation extracted; SOH options object)
src/engine/financialEngine.ts     (optional degradedYears path)
src/battery/{batteryModel,degradationModel,index}.ts  (optional config fields, DoD curve)
src/report/{types,reportModel}.ts (new sections, honest renames)
src/components/ExportReportModal.tsx (consume buildEngineeringReport)
src/api/{scenarios,types}.ts      (compareScenarios)
server/routes/{scenarios,simulations}.ts
src/App.tsx                       (SOH model opt-in)
src/types/bess.ts                 (DispatchOptions)
```

**Not touched:** `src/tariff/`, `src/import/`, `prisma/schema.prisma` (no schema change is expected —
comparison is computed, not stored), the other worktrees, `.env`.

---

## 5. Verification strategy

| What | How |
|---|---|
| Byte-identity of the default path | `dispatchEngine.{soc,targetPeak,noDoubleCounting,demand,netLoadBilling}.test.ts` and `engine/__tests__/scenarios.test.ts` pass **unmodified**; plus a new explicit regression test asserting `runIntervalDispatch(...)` with and without an empty options object are deep-equal |
| Aggregator extraction | Same suites, before/after |
| Rule 2 on both paths | `dispatchEngine.noDoubleCounting.test.ts` (heuristic) + new LP-path equivalent asserting Σcategories ≡ total discharged per interval |
| SOH → dispatch is real, not cosmetic | Test asserting a 70 % SOH run discharges strictly less energy than a 100 % SOH run on the same profile (would pass trivially if injected at `effectiveCapacityKwh`) |
| LCOS double-count resolution | Two tests (see Step 2e) |
| Financial floor | Test that an SOH forecast reaching 0 yields the documented 0.5 floor with `modelValidityFloorBoundFromYear` set, not a zeroed NPV |
| API | supertest, `{ result, correlationId }` envelope, 404/422 paths, Zod rejection |
| Persistence | Real run against **staging** (`DATABASE_URL` already resolves there), self-skipping preserved |
| Whole suite | `pnpm test`, `pnpm lint`, `pnpm build:all` green after every commit |

Baseline recorded before any change: **239 passed / 2 skipped (241)** with `DATABASE_URL` present
(221/20 without it, matching the brief).

---

## 6. Stop conditions

Work stops and documents rather than guesses if: the LP attribution rule cannot be made defensible;
a database identity check does not match the expected database or reports a replica; a generated
migration contains `DROP`/`TRUNCATE`/a destructive `ALTER`; or staging migration fails (which blocks
prod unconditionally).
