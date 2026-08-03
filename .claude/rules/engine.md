---
paths:
  - "bess-calc/src/engine/**/*.ts"
  - "bess-calc/src/types/**/*.ts"
  - "bess-calc/src/App.tsx"
---

# Calculation-engine rules

- Preserve explicit units: kW, kWh, kVA, kWh/kW, INR, litres, and minutes.
- Treat `bessPowerKw` as the single battery action for an interval.
- Attribute each discharged kWh to one dispatch purpose only.
- Apply charge/discharge efficiency and SOC limits at the point of state change.
- Keep validation independent enough to catch SOC, power, energy-balance, and
  commercial-ceiling errors.
- Add regression tests for every bug fix and scenario tests for cross-priority changes.
