# Coding guidelines (distilled)

This file distills `bess-calc/CLAUDE.md` and `.claude/rules/docs.md` for
quick reference. **Those files are authoritative** — if this summary and
either of them disagree, the source file wins; update this file to match,
don't act on the stale summary.

## From `bess-calc/CLAUDE.md`

- Inspect the smallest relevant file set before editing. Use
  [`../architecture/dependency-map.md`](../architecture/dependency-map.md)
  to find that set mechanically rather than guessing.
- Keep calculation logic in `bess-calc/src/engine/`, separate from React UI.
- Preserve the one-battery-per-interval model; do not double-count savings.
- State units, assumptions, boundaries, and data provenance for calculation
  changes.
- Add or update focused tests for behavior changes, including boundary
  cases.
- Do not claim API, PostgreSQL persistence, CSV import, or MILP/MPC exists
  unless the repository contains and tests that implementation. (As of this
  writing, API + PostgreSQL persistence + CSV import + LP-based
  optimisation via `javascript-lp-solver` **do** exist and are tested — see
  [`../architecture/execution-flows.md`](../architecture/execution-flows.md).
  MILP/MPC do not.)
- Do not modify unrelated documentation or roadmap phases.
- Never change production data or credentials.

## From `.claude/rules/docs.md`

- Distinguish implemented behaviour from planned architecture.
- Keep claims tied to repository evidence and dated verification.
- Do not turn roadmap items into completion claims.
- For calculation changes, document equations, units, assumptions,
  exclusions, validation cases, and source provenance.

## Commands (from `bess-calc/`)

```bash
npm ci
npm test
npm run lint
npm run build
```

For a focused change, run the relevant Vitest file first, then the full
suite.

## Task protocol (from `bess-calc/CLAUDE.md`)

1. Identify the affected files and direct dependencies.
2. Inspect only those files and the relevant architecture rule.
3. Implement the smallest complete change.
4. Run focused tests, then lint/build when practical.
5. Report changed files, commands and results, known limitations, and the
   next action.

Keep handoffs under 250 words. Preserve only the current task, changed
files, failures, constraints, and next action when compacting context.
