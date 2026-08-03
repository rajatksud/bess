# Dependency map

Source: `.agent/graph/import-graph.json` (madge, TS-aware via
`bess-calc/tsconfig.json`) and `.agent/graph/circular-report.txt`, generated
2026-08-03 from `dev/bess-calc` (`549e01c`) against `src/` and `server/`
(103 files traversed). Regenerate via `npm run architecture:generate`.

## How to use this for impact analysis

`import-graph.json` maps `file -> [files it imports]`. To find what's
**affected by** a change to file X (the mission's example: "modify
`batteryModel.ts`, what's affected?"), search the graph for every key whose
array contains X — that's a reverse lookup:

```bash
# from bess-calc/
node -e "
const g = require('../.agent/graph/import-graph.json');
const target = 'src/battery/batteryModel.ts';
for (const [file, deps] of Object.entries(g)) {
  if (deps.includes(target)) console.log(file);
}
"
```

Example result for `src/battery/batteryModel.ts` (run 2026-08-03):
`src/battery/batteryLibrary.ts`, `src/battery/degradationModel.ts`,
`src/battery/index.ts`, `src/battery/__tests__/batteryModel.test.ts`,
`src/battery/__tests__/fixtures.ts`. Note this is **narrower** than the
mission's illustrative example (`dispatchEngine.ts`, `lpModel.ts`,
`financialEngine.ts` are *not* affected) — `src/battery/` is not currently
imported by `src/engine/` or `src/optimisation/` (see the note in
[`module-map.md`](module-map.md)). Always run the real query rather than
assuming the mission's example graph applies here.

## Package dependencies (from `bess-calc/package.json`)

Runtime: `express`, `@prisma/client`, `javascript-lp-solver`, `papaparse`,
`react`/`react-dom`, `recharts`, `zod`, `clsx`, `tailwind-merge`,
`lucide-react`, `motion`.

Dev/build: `typescript`, `vite`, `vitest`, `prisma`, `tsup`, `tsx`,
`tailwindcss`, plus (added by this repository-intelligence pass) `madge` and
`dependency-cruiser`.

## Circular dependencies

**None found** within `src/` and `server/` as of 2026-08-03
(`.agent/graph/circular-report.txt`: "No circular dependency found!", 103
files processed). A run against `src`+`server` *including* `node_modules`
(not the default scope used above) does surface circulars, but they are all
inside third-party packages (`zod`, `superagent`, `recharts`,
`d3-interpolate`) — not actionable for this repository and excluded from the
generated report via `.dependency-cruiser.cjs`'s `doNotFollow: node_modules`.

## Suspicious coupling

- **`server/routes/simulation.ts` and `server/routes/simulations.ts` both
  import the full engine trio** (`dispatchEngine.ts`, `financialEngine.ts`,
  `validationEngine.ts`) independently. This is intentional per
  `CURRENT_CODE_ARCHITECTURE.md` (stateless vs. persistence-backed paths),
  not accidental duplication — but it means a bug fix in the dispatch/
  validation logic itself doesn't need to touch either route file (the
  engine files are the single source of truth), while a change to *how* the
  engine is invoked (new parameters, changed call signature) must be applied
  in both routes and in `src/App.tsx`. Verify all three call sites when
  changing an engine function's signature.
- **`src/types/bess.ts` has no imports of its own** (a leaf node) but is
  depended on by most of the rest of the graph — see "High blast-radius
  files" in `module-map.md`.
- **No forbidden-dependency violations** were found by the
  `engine-no-express` rule in `.dependency-cruiser.cjs` (engine/battery/
  tariff/optimisation/import modules do not import `express` or
  `@prisma/client`) — the documented client/server-shared-engine boundary
  currently holds in practice, not just in the design doc's stated intent.

## Regeneration and drift

This file's specific numbers (file counts, "no circular dependency" claim,
the suspicious-coupling list) can go stale as the codebase changes. Re-run
`npm run architecture:generate` and `npm run architecture:check` and spot-
check this file's claims against the fresh `.agent/graph/*` output before
relying on it for a non-trivial change.
