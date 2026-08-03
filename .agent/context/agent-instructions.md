# Agent instructions

The recommended workflow for using this repository's intelligence layer
before making a change, and how to keep it accurate afterward.

## Before coding

1. **Query the architecture map, don't re-derive it.** Start with
   [`../architecture/module-map.md`](../architecture/module-map.md) for
   "what module is this file in and what does it depend on", and
   [`../architecture/execution-flows.md`](../architecture/execution-flows.md)
   for "what's the request/data path through the system".
2. **Identify impacted modules via the dependency graph, not guesswork.**
   Use the reverse-lookup query in
   [`../architecture/dependency-map.md`](../architecture/dependency-map.md)
   against `.agent/graph/import-graph.json` to find every file that imports
   the file you're about to change. Don't assume the mission-brief-style
   example ("changing X affects Y, Z") applies here without checking — this
   codebase's actual import graph is sparser than that in places (e.g.
   `src/battery/` is not currently imported by `src/engine/` at all).
3. **Read only the files the graph says are relevant**, plus their direct
   tests (`__tests__/` alongside each module). Don't read the whole
   `src/` or `server/` tree for a targeted change.
4. **Check the dependency graph for boundary violations before adding an
   import.** If you're about to import `express` or `@prisma/client` into
   `src/engine/`, `src/battery/`, `src/tariff/`, `src/optimisation/`, or
   `src/import/`, stop — that violates the documented boundary in
   [`../architecture/architecture-decisions.md`](../architecture/architecture-decisions.md#1-engine-modules-are-framework-independent-by-design)
   and will fail `npm run architecture:check`.
5. **Implement the smallest safe change**, per
   [`coding-guidelines.md`](coding-guidelines.md) and `bess-calc/CLAUDE.md`.

## Verification

From `bess-calc/`:

```bash
npm test                      # focused file first, then full suite
npm run lint
npm run build
npm run architecture:check    # confirm no new forbidden/circular dependency
```

## After a structural change

If your change added/removed/moved a module, a route, or a Prisma model:

1. Run `npm run architecture:generate` to refresh `.agent/graph/*`.
2. Spot-check the affected sections of `module-map.md`, `dependency-map.md`,
   and `execution-flows.md` (API map / execution flow / DB map, as
   relevant) against the fresh graph output, and hand-edit if they drifted.
   These prose files are not auto-regenerated — see
   [`../README.md`](../README.md#regenerating) for why.
3. If the change affects `docs/architecture/CURRENT_CODE_ARCHITECTURE.md`'s
   claims (module list, data flow, dependency boundaries), update that file
   too — it's the human-readable companion to this directory.

Do not update `.agent/` or `docs/architecture/CURRENT_CODE_ARCHITECTURE.md`
speculatively for unrelated work — only when your change actually alters
the structure those files describe.
