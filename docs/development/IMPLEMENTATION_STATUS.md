# BESS Calculator — Implementation Status

Date: 2026-07-29
Branch: `feature/nightly-bess-foundation`
See `OVERNIGHT_PROGRESS_REPORT.md` for the repository understanding and gap
analysis that motivated the work below, and `NIGHTLY_BUILD_REPORT.md` for the
morning review package (files changed, command evidence, screenshots).

## Completed this pass

### 1. Rule 2 fix: energy-arbitrage saving was double-counting discharged energy

`src/engine/dispatchEngine.ts` — the arbitrage saving line previously used
`totalDischargedKwh` (the sum of *every* discharge category: backup/DG
displacement, peak shaving, AND TOU arbitrage) multiplied by a flat `20% of
tariff` factor. This re-monetized kWh already credited to demand-charge and
diesel-fuel savings. Fixed by introducing `totalArbitrageDischargedKwh` /
`totalArbitrageChargedKwh` accumulators populated only inside the
`'TOU Arbitrage Discharge'` / `'TOU Off-Peak Charge'` branches, and pricing
the saving at the actual TOU peak/off-peak rates rather than an approximated
factor. The grid-charging cost line was corrected at the same time to use the
real off-peak rate instead of an approximated `0.8x` multiplier.
Covered by `src/engine/__tests__/dispatchEngine.noDoubleCounting.test.ts`.

### 2. targetPeakKw bug: peak_shaving firing on ordinary base load

`src/engine/dispatchEngine.ts` — `targetPeakKw = Math.max(0, peakBeforeKw -
ratedPowerKw)` collapses to `0` whenever the battery's rated power is at or
above the profile's peak load. With `targetPeakKw = 0`, the `peak_shaving`
priority's trigger condition (`loadKw > targetPeakKw`) then matched **every**
interval with any load at all — discharging the battery against ordinary base
load that was never actually a demand-charge problem, and starving every
lower-priority use (solar self-consumption, arbitrage) of any opportunity to
claim the battery for that interval. Fixed so `targetPeakKw` is pinned at
`peakBeforeKw` itself when the battery already covers the whole peak (the
condition then never triggers, and priority correctly falls through to the
next one in the list). Covered by
`src/engine/__tests__/dispatchEngine.targetPeak.test.ts`, and this fix is a
prerequisite for Scenario B's solar-charging behaviour to work with the
default priority order (`peak_shaving` before `solar_self_consumption`).

### 3. Validation framework extended to check simulation OUTPUT, not just input

`src/engine/validationEngine.ts` gained `validateSimulationResult`, called
from `src/App.tsx` after `runIntervalDispatch` + `calculateFinancialMetrics`.
`validateBessConfig` (existing, unchanged in shape) only ever checked the
static input configuration before any simulation ran; it cannot catch a bug
that only manifests in the simulated per-interval trace or the aggregate
savings. `validateSimulationResult` adds:

- **Physical**: SOC below configured minimum / above configured maximum in
  any simulated interval; discharge or charge power exceeding the PCS rated
  power; simultaneous charge+discharge (structurally guarded even though the
  current single-scalar `bessPowerKw` model makes it currently impossible —
  protects against a future refactor reintroducing the bug); energy-balance
  replay check (reconstructs the SOC trace purely from each interval's own
  reported `bessPowerKw` and compares it against the reported final SOC — a
  mismatch means energy was implicitly created or destroyed somewhere).
- **Commercial**: diesel-displacement savings cannot exceed the DG energy the
  load profile actually required during outages; solar self-consumption
  savings cannot exceed actual surplus solar (generation above load); total
  diesel-attributed discharge cannot exceed total physical discharge; a
  payback figure must not be shown when net operating savings are zero or
  negative; a payback-not-achieved case is now surfaced as an explicit
  warning instead of silently rendering a blank field.

Covered by `src/engine/__tests__/validationEngine.test.ts`.

### 4. Test framework: Vitest, 45 tests across unit + scenario coverage

`vitest` + `@vitest/ui` added as devDependencies (`bess-calc/package.json`,
`bess-calc/vitest.config.ts`), run in `environment: 'node'` since the engine
is deliberately UI-independent per `CALCULATION_ENGINE_DESIGN.md`. New
`test` / `test:watch` / `test:ui` npm scripts.

| File | Tests | Coverage |
|---|---|---|
| `smoke.test.ts` | 1 | Harness sanity check |
| `dispatchEngine.soc.test.ts` | 5 | SOC floor/ceiling clamping, charge/discharge efficiency losses, rated-power clamp |
| `dispatchEngine.demand.test.ts` | 6 | Demand-charge saving (kVA/PF conversion, minimum-billing-demand floor), diesel fuel saving, solar self-consumption saving |
| `dispatchEngine.noDoubleCounting.test.ts` | 4 | Rule 2 regression: arbitrage saving isolation from diesel/peak-shaving energy, off-peak charging cost pricing |
| `dispatchEngine.targetPeak.test.ts` | 2 | targetPeakKw fix regression |
| `financialEngine.test.ts` | 7 | Payback (achieved/not-achieved), degradation-derated cash flows, LCOS, replacement CapEx timing, IRR bounds |
| `validationEngine.test.ts` | 9 | Static config checks (grades, error codes) + simulation-output checks (SOC bounds, rated-power violation, diesel-ceiling violation, payback-with-negative-savings) |
| `scenarios.test.ts` | 11 | Scenario A/B/C (see below) |

Fixtures live in `src/engine/__tests__/fixtures.ts` and mirror the app's own
`INITIAL_SYSTEM` / `INITIAL_TARIFF` / etc. defaults from `src/App.tsx`, so
tests exercise realistic configurations rather than arbitrary values.

### 5. Reference scenario tests (task brief Priority 5)

- **Scenario A — Industrial Peak Shaving** (500 kW peak load, 250 kW / 500 kWh
  BESS): confirms peak reduction is bounded by rated power, SOC stays in
  bounds, demand saving is positive, and `validateSimulationResult` reports no
  errors.
- **Scenario B — Solar + BESS**: confirms excess midday solar charges the
  battery (rather than being exported wholesale), reduces grid export versus
  the raw uncharged surplus, and the stored energy discharges to serve
  evening load (reducing evening grid import versus a no-battery baseline).
- **Scenario C — DG Replacement**: confirms a 4-hour outage window is fully
  covered by the battery (zero unserved backup energy), the annualised DG
  energy displaced matches exactly the outage-period requirement (no more, no
  less — direct Rule 2 check), and the resulting fuel saving is consistent
  with `specificFuelConsumptionLitrePerKwh x dieselPricePerLitre`.

### 6. Solar capacity input not wired into the interval simulation (found and fixed)

Independently of the overnight task's core scope, `src/engine/presetProfiles.ts`
generated each preset's solar curve from a hardcoded kW peak and never
consumed the `SolarInput` the rest of the app collects. `SolarInput.
dailySurplusSolarKwh` (the sales/legacy-facing field) was similarly never read
by the interval simulation. Fixed by threading `solar` into
`generateIntervals(resolutionMinutes, tariff, solar)` and scaling each
preset's solar curve by `installedCapacityKwp` relative to the reference kWp
that curve was authored against (150/100/220 kWp for the three presets
respectively) — the physically correct lever, matching `SolarInput`'s own
type definition, since installed kWp drives a kW generation curve. `App.tsx`
updated to pass `solar` through. This fix was required to make the
`generateIntervals` signature change consistent across `App.tsx` and all
three presets in this worktree (it had already been fixed independently on
`dev/bess-calc`, which this branch predates).

## Explicitly not touched, and why

Unchanged from the original gap analysis in `OVERNIGHT_PROGRESS_REPORT.md`:

- **`legacyEngine.ts`** — intentionally reproduces flawed sales-pitch
  arithmetic as a documented counter-example (Comparison tab). Left as-is.
- **UI components** (`src/components/*.tsx`) — contain no calculation logic;
  out of scope for a calculation-engine-focused pass. (The one exception —
  `QuickEstimateWizard.tsx` tooltips and the Installed Capacity input field —
  was already delivered separately on `dev/bess-calc` before this branch was
  created; not duplicated here to avoid a messy merge.)
- **Backend/API/Python services, PostgreSQL, MILP/MPC optimisation** — Phase
  3+ roadmap items per the product strategy doc. Building them now would
  violate the "don't introduce unnecessary frameworks / don't optimise
  prematurely" guard rail.

## Known issues / limitations

1. **`peak_shaving`'s `targetPeakKw` still compares against gross `loadKw`,
   not load net of solar.** The fix in this pass (item 2 above) resolves the
   specific failure mode where the battery is rated above the profile's
   peak — `peak_shaving` no longer fires on every interval with nonzero load
   in that case. It does **not** address the more general question of
   whether `peak_shaving` should target net load (load minus concurrent
   solar) when the battery is genuinely smaller than the peak. Recommended
   next step: decide whether `targetPeakKw` and the peak-shaving trigger
   should be computed from `loadKw - solarKw` instead of `loadKw` alone, and
   whether that changes the intended interaction with `solar_self_consumption`
   when both priorities are active on the same profile.
2. **Priority ordering is dispatch-consequential and not tested exhaustively.**
   The dispatch loop's `if (bessPowerKw !== 0) continue` means the *order* of
   `priorities` materially changes outcomes (see item 1). Only the default
   order (`backup_reserve, peak_shaving, solar_self_consumption,
   diesel_displacement, tou_arbitrage`) and a couple of variants are tested.
   A property-based or exhaustive-permutation test would give higher
   confidence that no priority ordering produces a physically invalid result.
3. **Component/UI tests are out of scope for this pass.** `IntervalSimulation.
   tsx`, `ResultsDashboard.tsx`, `ScenarioSensitivity.tsx`,
   `LegacyComparisonModal.tsx`, and `ExportReportModal.tsx` have zero test
   coverage. They contain no calculation logic (confirmed in the progress
   report), so the risk is primarily around correct prop wiring and
   formatting, not calculation correctness.
4. **`validateSimulationResult`'s energy-imbalance check replays SOC from
   `bessPowerKw` alone** and does not independently re-derive `bessPowerKw`
   from `loadKw`/`solarKw`/priorities — it can catch a broken SOC *integration*
   step but not a broken *dispatch decision* that still integrates
   consistently with itself. A stronger check would re-run the full dispatch
   priority logic independently and compare `bessAction` per interval, but
   that essentially re-implements the engine and risks becoming a second
   source of truth that drifts from the real one.
5. **`legacyEngine.ts`'s `dailySurplusSolarKwh` is still an independent,
   sales-facing input** with no cross-check against the interval simulation's
   `installedCapacityKwp`-derived solar output. This is intentional (the
   Comparison tab exists specifically to contrast the two), but a user could
   set these to wildly inconsistent values without any warning connecting
   them.

## Recommended next sprint (prioritised)

1. Resolve the gross-vs-net-load `targetPeakKw` question (limitation 1) and
   add a validation check that peak_shaving and solar_self_consumption
   produce a coherent joint outcome regardless of priority order.
2. Add component-level tests for `ResultsDashboard.tsx` (the highest-traffic
   consumer of `SimulationResult`) to catch prop/formatting regressions.
3. Extend `validateSimulationResult` with the exhaustive-permutation dispatch
   check described in limitation 2, at least as a property-based test rather
   than a runtime validation (keeps runtime validation cheap).
4. Revisit `legacyComparison` wiring in `SimulationResult` — it is defined in
   `types/bess.ts` but not populated by `App.tsx`'s `simulationResult` memo;
   confirm whether `LegacyComparisonModal.tsx` computes it separately or
   whether this is a real gap.
5. Phase 3+ roadmap items (backend API, persistence, MILP/MPC optimisation)
   remain deferred per the product strategy's own phasing — no change to that
   plan recommended from this pass's findings.
