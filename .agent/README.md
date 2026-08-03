# `.agent/` — repository intelligence layer

Machine-readable-first context for AI agents (and humans) working on this
repository, built so that a task can be scoped to a small set of relevant
files instead of reading the whole codebase.

Read [`context/agent-instructions.md`](context/agent-instructions.md) first — it
defines the recommended workflow for using everything else in this
directory before making a change.

## Layout

```
.agent/
├── README.md                          this file
├── architecture/
│   ├── module-map.md                  layer diagram + module responsibilities
│   ├── dependency-map.md              import graph summary, circular-dependency status
│   ├── execution-flows.md             simulation flow + full API map (route -> service -> DB)
│   └── architecture-decisions.md      key decisions found in code, with source citations
├── context/
│   ├── repository-summary.md          orientation: where things live, how to run/test/build
│   ├── coding-guidelines.md           distilled from CLAUDE.md / .claude/rules
│   └── agent-instructions.md          the recommended before-you-code workflow
└── graph/
    ├── import-graph.json              madge-derived import graph (machine-readable)
    ├── import-graph.dot               dependency-cruiser DOT rendering of the same graph
    ├── circular-report.txt            madge --circular output
    └── module-inventory.json          directory-derived module/file inventory
```

## Regenerating

The `graph/` directory and the module-list portions of `architecture/*.md`
are derived from the actual source tree, not hand-maintained. Regenerate
after any change to `src/` or `server/`'s module structure or imports:

```bash
cd bess-calc
npm run architecture:generate   # regenerates .agent/graph/
npm run architecture:check      # fails if a new circular or forbidden dependency appears
```

`architecture:generate` overwrites `.agent/graph/*` deterministically (same
input tree -> same output, modulo the `generatedAt` date in
`module-inventory.json`). The prose files in `architecture/` and `context/`
are hand-written and should be spot-checked against `graph/` output after
regenerating, not regenerated automatically — see
[`architecture-decisions.md`](architecture/architecture-decisions.md) for
why this split exists.

## Relationship to `docs/`

This directory is optimized for machine consumption and fast scoping.
[`docs/architecture/CURRENT_CODE_ARCHITECTURE.md`](../docs/architecture/CURRENT_CODE_ARCHITECTURE.md)
is the prose companion, written for a human or an agent doing a first read
of the whole system. `docs/architecture/BESS_SYSTEM_ARCHITECTURE.md` and
other `docs/` roadmap material describe target/aspirational state, not
current behaviour — do not treat them as accurate for "what does the code do
today" questions; use this directory and `CURRENT_CODE_ARCHITECTURE.md`
instead.
