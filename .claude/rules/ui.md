---
paths:
  - "bess-calc/src/components/**/*.tsx"
  - "bess-calc/src/index.css"
---

# UI rules

- Keep calculation decisions in `src/engine/`; components should format,
  collect inputs, and compose views.
- Preserve explicit warnings and confidence grades in result displays.
- Do not change engine behaviour while making presentational changes.
- Run the engine test suite and TypeScript lint after changing result wiring.
