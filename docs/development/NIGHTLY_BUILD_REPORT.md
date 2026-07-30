# Nightly Build Report — BESS Calculator Foundation

Date: 2026-07-29
Branch: `feature/nightly-bess-foundation` (base: `66de54e` on the trunk)
Scope: `bess-calc/` calculation engine (dispatch, validation, financial) +
test infrastructure. See `OVERNIGHT_PROGRESS_REPORT.md` for the repository
understanding this work started from, and `IMPLEMENTATION_STATUS.md` for the
detailed per-item writeup and follow-up backlog.

## Summary

Read the entire `bess-calc` app and the authoritative `docs/` architecture
before making any change (Priority 1). Found the engine foundation already
substantially built — one battery model, a full DCF financial engine, and a
partial validation framework — so this pass **extended rather than
rewrote** it, per the task's explicit guard rail against unnecessary
rewrites. Three real defects were found and fixed in the calculation engine,
a validation gap was closed, and a 45-test suite (Vitest) was added to lock
in correct behaviour and prevent regressions on all of it.

## What was built

1. **Fixed a Rule 2 (no double counting) violation**: the energy-arbitrage
   saving was computed from the combined total of *every* discharge category
   (backup/DG displacement + peak shaving + arbitrage) rather than only the
   energy actually dispatched for arbitrage — silently re-monetizing kWh
   already credited elsewhere. Now uses dedicated per-category accumulators
   and real TOU peak/off-peak rates instead of an approximated flat factor.
2. **Fixed a peak-shaving targeting bug**: `targetPeakKw` collapsed to `0`
   whenever the battery's rated power was at or above the profile's peak
   load, causing peak-shaving to fire on every interval with any load at
   all — starving solar self-consumption and arbitrage of any chance to use
   the battery. Now pinned at the profile's own peak when the battery already
   covers it, so the trigger correctly never fires in that case.
3. **Extended the validation framework** with `validateSimulationResult`,
   which checks the actual simulation *output* (SOC bounds during dispatch,
   impossible discharge/charge power, an energy-balance replay check,
   diesel/solar savings against their physical ceilings, and payback/negative-
   savings consistency) — closing the gap where `validateBessConfig` alone
   could only check static inputs before any simulation ran.
4. **Added Vitest as the test framework** (`vitest` + `@vitest/ui`,
   `environment: 'node'`, no DOM — the engine is UI-independent by design)
   and wrote 45 tests: unit tests for SOC/efficiency, demand-charge/diesel/
   solar savings formulas, financial engine (payback, degradation,
   replacement CapEx, LCOS, IRR bounds), and both validation functions; plus
   the three reference scenarios from the task brief (Industrial Peak
   Shaving, Solar + BESS, DG Replacement).
5. **Fixed the interval simulation ignoring the Solar Installed Capacity
   input**: `presetProfiles.ts`'s solar curve generators used a hardcoded kW
   peak and never read `SolarInput` at all. Threaded `solar` through
   `generateIntervals` and scaled each preset's curve by
   `installedCapacityKwp` relative to its reference kWp.

## Files changed

Diff vs. branch base (`66de54e`), 17 files, +1928/-28:

```text
bess-calc/package.json                                  |   9 +-
bess-calc/package-lock.json                              | 443 ++++++++-
bess-calc/vitest.config.ts                               |  13 + (new)
bess-calc/src/App.tsx                                     |  22 +-
bess-calc/src/engine/dispatchEngine.ts                    |  66 +-
bess-calc/src/engine/presetProfiles.ts                    |  28 +-
bess-calc/src/engine/validationEngine.ts                  | 247 ++++-
bess-calc/src/engine/__tests__/fixtures.ts                | 132 + (new)
bess-calc/src/engine/__tests__/smoke.test.ts               |   7 + (new)
bess-calc/src/engine/__tests__/dispatchEngine.soc.test.ts  |  94 + (new)
bess-calc/src/engine/__tests__/dispatchEngine.demand.test.ts        | 128 + (new)
bess-calc/src/engine/__tests__/dispatchEngine.noDoubleCounting.test.ts | 113 + (new)
bess-calc/src/engine/__tests__/dispatchEngine.targetPeak.test.ts    |  52 + (new)
bess-calc/src/engine/__tests__/financialEngine.test.ts     | 136 + (new)
bess-calc/src/engine/__tests__/validationEngine.test.ts    | 130 + (new)
bess-calc/src/engine/__tests__/scenarios.test.ts            | 150 + (new)
docs/development/OVERNIGHT_PROGRESS_REPORT.md               | 186 + (new)
docs/development/IMPLEMENTATION_STATUS.md                   | (new, this commit)
docs/development/NIGHTLY_BUILD_REPORT.md                    | (new, this document)
```

Commits on this branch (oldest to newest):

```text
d72ffd1 docs: add overnight progress report with repo understanding and gap analysis
d39f185 fix(engine): stop double-counting discharged energy in arbitrage saving
21b4456 test: add Vitest test framework
df7b7d9 feat(validation): validate simulation output, not just static config
dd7810f fix(engine): peak-shaving target must not collapse to zero for well-sized batteries
f40ef08 test(engine): add unit and scenario test suite for the calculation engine
(+ this commit: docs: implementation status and nightly build report)
```

`legacyEngine.ts` and all `src/components/*.tsx` files are **unchanged** —
confirmed no calculation logic lives in the UI layer, and `legacyEngine.ts`'s
flawed arithmetic is intentional (it exists specifically to be shown as a
counter-example in the Comparison tab).

## Tests

Command: `cd bess-calc && npx vitest run`

```text
 RUN  v4.1.10 .../bess-calc

 ✓ src/engine/__tests__/smoke.test.ts (1 test)
 ✓ src/engine/__tests__/dispatchEngine.noDoubleCounting.test.ts (4 tests)
 ✓ src/engine/__tests__/dispatchEngine.targetPeak.test.ts (2 tests)
 ✓ src/engine/__tests__/dispatchEngine.demand.test.ts (6 tests)
 ✓ src/engine/__tests__/financialEngine.test.ts (7 tests)
 ✓ src/engine/__tests__/dispatchEngine.soc.test.ts (5 tests)
 ✓ src/engine/__tests__/validationEngine.test.ts (9 tests)
 ✓ src/engine/__tests__/scenarios.test.ts (11 tests)

 Test Files  8 passed (8)
      Tests  45 passed (45)
```

Command: `cd bess-calc && npx tsc --noEmit -p .`
Result: exit code 0, no output (no type errors).

Command: `cd bess-calc && npm run build`

```text
> bess-roi-calculator@1.0.0 build
> tsc && vite build

vite v6.4.3 building for production...
✓ 2219 modules transformed.
dist/index.html                  0.85 kB │ gzip:   0.48 kB
dist/assets/index-*.css         31.30 kB │ gzip:   5.94 kB
dist/assets/index-*.js         659.80 kB │ gzip: 182.39 kB
✓ built in ~6s
```

(The chunk-size warning is pre-existing — a single-bundle Vite output, not
introduced by this pass. Noted as out of scope; not a functional issue.)

No screenshots — this pass touched calculation-engine code only, no UI
changes.

## Technical debt / known limitations

See `IMPLEMENTATION_STATUS.md` "Known issues / limitations" for full detail.
Highlights:

- `peak_shaving`'s target is still based on gross load, not load net of
  concurrent solar generation — the fix in this pass resolves the specific
  "battery ≥ peak load" failure mode but not the general net-load question.
- No component/UI test coverage (out of scope; no calculation logic in the
  UI layer per the progress-report audit).
- `SimulationResult.legacyComparison` is declared in `types/bess.ts` but
  never populated — `LegacyComparisonModal.tsx` computes its own comparison
  independently. Likely dead code; flagged for a decision, not removed
  without confirming nothing else depends on it.
- Dispatch priority ordering is only spot-tested, not exhaustively verified
  across all permutations.

## Recommended next sprint

See `IMPLEMENTATION_STATUS.md` for the full prioritised list. Top item:
resolve the gross-vs-net-load peak-shaving question, since it's the one
remaining known interaction that can silently change simulation results
depending on dispatch priority order.

## For the reviewer

Every commit on this branch is scoped to a single concern (see commit list
above). `npm run build`, `npx vitest run`, and `npx tsc --noEmit` all pass
at the branch tip (evidence above) — per-commit build/test status along the
way was not independently re-verified by checking out each commit, so treat
that as likely-but-unconfirmed if it matters for your review process. No
files outside `bess-calc/` and `docs/development/` were touched. No secrets,
credentials, or destructive operations were involved. This branch has not
been pushed or merged — that is left for morning review and explicit
approval.
