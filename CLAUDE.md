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
- Do not claim that API, PostgreSQL persistence, CSV import, or MILP/MPC exists
  unless the repository contains and tests that implementation.
- Do not modify unrelated documentation or roadmap phases.
- Never change production data or credentials.

## Commands

Run from `bess-calc/`:

```text
npm ci
npm test
npm run lint
npm run build
```

For a focused change, run the relevant Vitest file first, then the full suite.

## Task protocol

1. Identify the affected files and direct dependencies.
2. Inspect only those files and the relevant architecture rule.
3. Implement the smallest complete change.
4. Run focused tests, then lint/build when practical.
5. Report changed files, commands and results, known limitations, and the next action.

Keep handoffs under 250 words. Preserve only the current task, changed files,
failures, constraints, and next action when compacting context.
