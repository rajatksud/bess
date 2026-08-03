import { defineConfig } from 'vitest/config';

// Scope: unit + scenario tests for the calculation/tariff/import/optimisation engines
// (src/**) plus the Express API boundary (server/**). Component/UI testing is out of
// scope for this pass - the engine layers are designed to be usable independent of
// React (see CALCULATION_ENGINE_DESIGN.md), so tests run in plain Node, no DOM
// environment required.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    reporters: 'default',
  },
});
