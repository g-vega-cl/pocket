import { describe, it, expect } from 'vitest';

describe('Pocket Module Tests', () => {
  it('should export Route from pocket.tsx', async () => {
    const pocket = await import('../routes/pocket');
    expect(pocket.Route).toBeDefined();
  });

  it('should have usePocket hook', async () => {
    const hook = await import('../hooks/usePocket');
    expect(hook.usePocket).toBeDefined();
    expect(typeof hook.usePocket).toBe('function');
  });
});
