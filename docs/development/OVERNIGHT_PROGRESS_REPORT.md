# Overnight Progress Report — BESS Calculator Foundation

Date: 2026-07-29
Branch: `feature/nightly-bess-foundation`
Scope of this document: repository understanding and gap analysis performed
**before** implementing Priority 2–5 of the nightly build task. This is a living
record — see `IMPLEMENTATION_STATUS.md` and `NIGHTLY_BUILD_REPORT.md` for the
final state once all priorities are complete.

## 1. Repository structure found

Two independent things live in this repo:

1. **Root-level `docs/`** — the authoritative product/architecture direction
   (product strategy, battery model architecture, system architecture,
   calculation engine design, optimisation engine design, tariff engine design,
   and a detailed coding specification derived from a sales-illustration
   reference case). This is design intent, not code.
2. **`bess-calc/`** — a working Vite + React 18 + TypeScript 5.7 app, generated
   by Google AI Studio, that already implements a large fraction of the coding
   specification. `bess-calc/docs/` does **not** exist (it was deliberately
   removed previously as a duplicate of root `docs/` — confirmed by directory
   listing; this document intentionally stays at repo root).

### `bess-calc/` inventory (all files read in full before any changes)

- `src/types/bess.ts` (210 lines) — input/output type definitions. These map
  almost 1:1 onto the schema in `docs/BESS_ROI_Calculator_Coding_Specification.md`
  section 7–8 (`BessSystemInput`, `TariffInput`, `DieselInput`, `SolarInput`,
  `FinancialInput`, `IntervalRecord`, `SavingsBreakdown`, `TechnicalResult`,
  `FinancialResult`, `ValidationWarning`, `SimulationResult`). No gaps in the
  type model worth closing right now.
- `src/engine/dispatchEngine.ts` (287 lines, pre-change) — the single-battery
  interval dispatch simulation. Runs a priority list (`backup_reserve` →
  `peak_shaving` → `solar_self_consumption` → `diesel_displacement` →
  `tou_arbitrage`) once per interval, and **stops at the first priority that
  claims the battery** (`if (bessPowerKw !== 0) continue`). This is the correct
  shape for Rule 1 (one battery model) — there is one `bessPowerKw` scalar per
  interval, not three parallel calculators.
- `src/engine/financialEngine.ts` (168 lines) — cash-flow projection with
  degradation-derated savings, escalation, straight-line depreciation, tax,
  replacement capex, residual value, NPV, bisection-method IRR, simple and
  discounted payback, LCOS. Structurally matches spec section 6. No rewrite
  needed.
- `src/engine/validationEngine.ts` (150 lines) — checks a subset of the
  physical/commercial/financial rules in spec section 9 (invalid power/energy,
  SOC bounds, reserve vs DoD, low efficiency, kVA-without-PF, high fuel factor,
  clipped solar surplus, zero capex) and assigns a confidence grade (A/B/C/D).
  Solid foundation; several rules from the spec's checklist (section 9, items
  9–15) and the task's own validation list (SOC bounds *during simulation*,
  simultaneous charge/discharge, energy imbalance, diesel/solar savings vs.
  physical ceiling, negative payback) are not yet checked. These require the
  *simulation output* (intervals + savings + financial result), not just the
  static input config that `validateBessConfig` currently receives — this is
  the main gap closed in Priority 4.
- `src/engine/legacyEngine.ts` (109 lines) — reproduces the original sales-pitch
  arithmetic verbatim (unconstrained, double-counting, kW/kVA conflated) so the
  UI can show it side-by-side as a labelled "Legacy Illustration Mode", per
  spec section 14's "Reference-case test" requirement. This is intentional and
  correct as designed — it must **not** be corrected into real logic, because
  its entire purpose is to demonstrate what the flawed illustration produces.
  Left untouched.
- `src/engine/presetProfiles.ts` (216 lines) — three synthetic 24h interval-
  profile generators (industrial 24/7 + outages, commercial office + TOU,
  solar-heavy microgrid) used to drive the interval simulation without
  requiring a CSV upload feature yet. No changes needed for this pass.
- `src/components/*.tsx` (7 files, ~1550 lines total) — UI wiring only
  (Header, QuickEstimateWizard, IntervalSimulation config, ResultsDashboard,
  ScenarioSensitivity, LegacyComparisonModal, ExportReportModal). Confirmed
  these contain no calculation logic of their own — they call into
  `src/engine/*` and render results. Consistent with the "keep domain
  calculation logic separate from UI" requirement; left untouched in this pass.
- `src/App.tsx` (339 lines) — wires state, applies sensitivity multipliers,
  and calls `validateBessConfig` → `runIntervalDispatch` →
  `calculateFinancialMetrics` in that order. Matches the calculation flow in
  `CALCULATION_ENGINE_DESIGN.md` (Validation → Normalisation → Battery
  Simulation → Savings → Financial Analysis).
- **Zero test files, no test framework in `package.json`** prior to this work.
  Confirmed by reading `package.json` in full (scripts: `dev`, `build`, `lint`
  only; no `vitest`/`jest`/`@testing-library/*` in dependencies).

## 2. Gap analysis against the four core rules

### Rule 1 — One battery model

**Mostly upheld already.** There is exactly one `bessPowerKw` value computed
per interval, and the priority loop is a single pass that stops once the
battery is claimed for that interval. No separate "diesel battery" /
"solar battery" / "peak-shaving battery" objects exist. No change needed to
this structural property.

### Rule 2 — No double counting

**One real violation found and fixed** (see below). The dispatch loop
correctly tags each interval's `bessAction` (e.g. `'Peak Shaving'`,
`'Diesel Displacement'`, `'TOU Arbitrage Discharge'`) and — for diesel and
solar — accumulates dedicated per-category energy totals
(`totalDgDisplacedKwh`, `totalSolarStoredKwh`) that the corresponding savings
formulas actually use. **However**, the energy-arbitrage saving line was
computed from `totalDischargedKwh`, the grand total across *every* discharge
category (backup/DG displacement, peak shaving, and TOU arbitrage all summed
together), multiplied by a flat "20% of energy tariff" factor. That silently
re-monetized kWh that had already been credited to demand-charge savings and
diesel-fuel savings above it — a direct violation of the "same stored energy
cannot simultaneously generate diesel savings, solar savings, AND demand
savings" rule from the task brief, just expressed via the arbitrage line
rather than as a naive triple-count. This is fixed in Priority 2 below by
introducing dedicated `totalArbitrageDischargedKwh` /
`totalArbitrageChargedKwh` accumulators and rewriting the arbitrage saving to
use only that attributed energy, priced at the actual TOU peak/off-peak
rates rather than a flat factor.

A secondary, smaller inconsistency was found in the same area: the pre-existing
`chargingEnergyCost` line used an approximated "0.8x standard tariff" factor
for grid-charging cost, while all the *energy* that ever populates
`totalGridChargedKwh` actually originates from the TOU off-peak-charge branch
(verified by grep — no other code path increments it). Now that the arbitrage
fix needed a real off-peak rate anyway, `chargingEnergyCost` was corrected to
use that same rate, removing the approximation and the risk that a future
change could double the deduction (once via the approximated flat cost, once
via a properly attributed TOU rate).

### Rule 3 — Transparent assumptions

Already reasonably strong: `SimulationResult` carries `confidenceGrade`,
`confidenceGradeReason`, the full `warnings` list, and every input structure
used for the calculation. `ValidationWarning` has `level`
(error/warning/info), `category` (physical/commercial/financial), `code`, a
human-readable `message`, and a `recommendation`. This structure is sound and
is extended, not replaced, in Priority 4.

## 3. Decision: extend, don't rewrite

Per the task's explicit instruction to check existing engines before assuming
a rewrite is needed: **no engine file is rewritten from scratch.** The dispatch
engine's structure (single `bessPowerKw`, priority loop, before/after peak
comparison) is sound and is kept. Only the arbitrage-saving/charging-cost
double-count is corrected, with the fix scoped to the smallest set of lines
that removes the violation while preserving every other formula. This follows
the "prefer completing fewer features correctly" instruction and the
guard-rail against rewriting the whole application.

## 4. Test framework decision

**Vitest** is added as the test runner (`vitest` + `@vitest/ui` as
devDependencies), consistent with the existing Vite 6 toolchain — no new
bundler or transform pipeline is introduced. Tests run under
`environment: 'node'` (no DOM), because the object of this pass is the
calculation engine (`src/engine/**`), which is explicitly designed in
`CALCULATION_ENGINE_DESIGN.md` to be usable independent of the UI. Component
tests are out of scope for this pass and are listed as a follow-up in
`IMPLEMENTATION_STATUS.md`.

## 5. What is explicitly NOT touched in this pass, and why

- **`legacyEngine.ts`** — intentionally reproduces flawed arithmetic; that is
  its documented purpose (spec section 14, "Reference-case test"). Correcting
  it would remove the regression-prevention value it provides.
- **UI components** (`src/components/*.tsx`) — no calculation logic found in
  them; changing them is out of scope for a calculation-engine-focused pass
  and risks the "don't rewrite the whole application" guard rail.
- **`presetProfiles.ts`** — synthetic profile generators are adequate for
  scenario testing; not a gap for this pass.
- **Backend/API/Python services, PostgreSQL, MILP/MPC optimisation** — these
  are Phase 3+ items in the product strategy roadmap (Layer 3 onward). Building
  them now would violate "don't introduce unnecessary frameworks" /
  "don't optimise prematurely." Deferred to `IMPLEMENTATION_STATUS.md`'s
  recommended next steps.

## 6. Priorities executed after this analysis

1. ~~Repository understanding (this document)~~ — done.
2. Calculation engine foundation — extend `dispatchEngine.ts` to fix the
   Rule 2 violation identified above; verify remaining formulas.
3. MVP simulation — already present via `IntervalSimulation.tsx` +
   `dispatchEngine.ts`; confirmed adequate, no duplication introduced.
4. Validation framework — extend `validationEngine.ts` with the
   simulation-output checks (SOC bounds during simulation, simultaneous
   charge/discharge, energy imbalance, savings-vs-physical-ceiling checks,
   negative payback) that require simulation results, not just static config.
5. Tests — Vitest set up; unit tests for SOC/efficiency/demand/diesel/solar/
   financial; scenario tests A (industrial peak shaving), B (solar + BESS),
   C (DG replacement).

See `IMPLEMENTATION_STATUS.md` and `NIGHTLY_BUILD_REPORT.md` for outcomes,
actual command output, and the prioritised backlog for the next sprint.
