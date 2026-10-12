# AGENTS.md

## Standing rules for every worktree

1. **Status file.** Keep `docs/implementation/status/<worktree>.md` current: at least hourly while active and after every test or gate run. Table columns: `Item | Status (planned/WIP/not active/done) | Evidence | Blocker | Next action | Updated (IST)`. `done` only with verified evidence.
2. **Authority.** `docs/development/AUTONOMOUS_EXECUTION_PLAN.md` and `docs/product/BESS_PLATFORM_PRODUCT_STRATEGY.md`. Don't edit them unless told to.
3. **Commit and push** verified changes and evidence in scoped commits. Never merge into `dev` or `main`.
4. **Supervisor instructions.** Follow plan-update and execute instructions as given; stop and report if one conflicts with authority or guardrails. End each run with objectives met/not met, evidence, commits, and blockers.
