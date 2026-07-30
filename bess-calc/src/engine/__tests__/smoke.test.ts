import { describe, it, expect } from 'vitest';

describe('vitest harness smoke test', () => {
  it('runs basic assertions', () => {
    expect(1 + 1).toBe(2);
  });
});
