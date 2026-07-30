import { defineConfig } from 'vitest/config';

// Scope: unit + scenario tests for the calculation engine (src/engine/**).
// Component/UI testing is out of scope for this pass - the engine is designed to be
// usable independent of React (see CALCULATION_ENGINE_DESIGN.md), so tests run in
// plain Node, no DOM environment required.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'default',
  },
});
