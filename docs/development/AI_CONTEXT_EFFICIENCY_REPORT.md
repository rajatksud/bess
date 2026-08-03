# AI Context Efficiency Report

Measured, not estimated, on 2026-08-03 against `dev/bess-calc` (`549e01c`)
plus this pass's additions. Methodology: byte counts via `wc -c`,
approximate token count via the common `chars / 4` heuristic for English/
code text. This is an approximation, not a tokenizer-exact count, but
consistent enough between "before" and "after" to compare directly since
both are measured the same way.

## Task used for measurement

"Understand the simulation flow well enough to safely change
`src/engine/dispatchEngine.ts`'s dispatch logic (e.g., the `targetPeakKw`
gross-vs-net-load question noted as open in `IMPLEMENTATION_STATUS.md`)." —
chosen because `dispatchEngine.ts` is the single most-referenced engine file
in the actual import graph (used by both the client path and both
persistence/stateless server routes — see
`.agent/architecture/module-map.md`, "High blast-radius files").

## Before: no repository intelligence layer

Without `.agent/`, an agent locating every consumer and dependency of
`dispatchEngine.ts` has no way to do a targeted reverse-lookup and would
plausibly read the whole plausible surface: the file itself, its direct
type dependency, every file that calls it (client + both server routes),
and the sibling modules a human would guess might be related (battery,
tariff, optimisation, import) before confirming via reading whether they're
actually connected.

| File | Lines | Bytes |
|---|---|---|
| `src/App.tsx` | 360 | 11,964 |
| `src/engine/dispatchEngine.ts` | 449 | 22,080 |
| `src/engine/financialEngine.ts` | 168 | 5,953 |
| `src/engine/validationEngine.ts` | 381 | 17,115 |
| `src/engine/presetProfiles.ts` | 250 | 9,483 |
| `src/battery/batteryModel.ts` | 38 | 2,115 |
| `src/battery/degradationModel.ts` | 100 | 4,911 |
| `src/battery/cycleCounting.ts` | 72 | 2,824 |
| `src/tariff/tariffEngine.ts` | 147 | 6,537 |
| `src/tariff/dispatchAdapter.ts` | 31 | 1,358 |
| `src/optimisation/lpModel.ts` | 219 | 9,142 |
| `src/optimisation/heuristicDispatch.ts` | 66 | 3,288 |
| `src/optimisation/optimisedDispatch.ts` | 164 | 7,023 |
| `src/import/toEngineIntervals.ts` | 83 | 3,781 |
| `src/types/bess.ts` | 241 | 8,222 |
| `server/routes/simulation.ts` | 102 | 3,626 |
| `server/routes/simulations.ts` | 176 | 7,138 |
| `server/app.ts` | 98 | 3,966 |

**18 files, 130,526 bytes, ≈32,600 tokens.**

## After: using `.agent/architecture/dependency-map.md`

The reverse-lookup query in `dependency-map.md` against
`.agent/graph/import-graph.json` returns the exact, verified consumer list
for `src/engine/dispatchEngine.ts` in one step:

```
server/routes/simulation.ts
server/routes/simulations.ts
src/App.tsx
src/engine/__tests__/*.test.ts (6 files)
```

Combined with `dispatchEngine.ts`'s own single internal dependency
(`src/types/bess.ts`, confirmed via the same graph — battery/tariff/
optimisation are **not** imported by it, contrary to what a plausible guess
would assume), the actually-relevant file set is:

| File | Bytes |
|---|---|
| `src/engine/dispatchEngine.ts` | 22,080 |
| `src/types/bess.ts` | 8,222 |
| `server/routes/simulation.ts` | 3,626 |
| `server/routes/simulations.ts` | 7,138 |
| `src/App.tsx` | 11,964 |
| `.agent/architecture/module-map.md` (read once, to get here) | 4,923 |
| `.agent/architecture/dependency-map.md` (read once, to get here) | 3,995 |
| `.agent/architecture/execution-flows.md` (confirms the two call paths) | 7,562 |

**5 source files + 3 map documents, 69,510 bytes, ≈17,400 tokens.**

(Test files are omitted from both counts — they'd be read in both scenarios
once the relevant module is identified, so they don't differentiate the
comparison.)

## Result

| | Files (source) | Bytes | Approx. tokens |
|---|---|---|---|
| Before | 18 | 130,526 | ~32,600 |
| After | 5 + 3 map docs | 69,510 | ~17,400 |

**≈47% fewer bytes / tokens, and the reverse-dependency query eliminates
guessing** — the "after" scope also **corrects** a wrong assumption the
"before" scope would have carried silently: `src/battery/` is not currently
imported by `src/engine/` at all, so time spent reading
`batteryModel.ts`/`degradationModel.ts`/`cycleCounting.ts` in the "before"
approach (129 lines, ~4% of the before-scope bytes) is not just slower, it
risks the agent believing a call path exists that doesn't.

## Caveats

- This is one measured task, not an average across many. The ratio will
  vary — a change to `src/types/bess.ts` (the highest blast-radius file)
  would show a *smaller* efficiency gain, since nearly everything legitimately
  needs to be considered.
- The three map documents read in the "after" case are a fixed overhead
  that amortizes across many tasks (read once per session, not once per
  file changed), so the real per-task gain in a longer session is larger
  than this single-task comparison shows.
- Token counts are the `chars/4` approximation, not a real tokenizer run —
  treat the ~47% figure as directionally accurate, not exact.
