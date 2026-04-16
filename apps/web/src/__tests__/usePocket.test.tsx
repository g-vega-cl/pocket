import { describe, it, expect, vi } from 'vitest';

describe('usePocket Hook', () => {
  it('should be defined', async () => {
    const { usePocket } = await import('../hooks/usePocket');
    expect(usePocket).toBeDefined();
  });

  it('should return an object with expected methods', async () => {
    const { usePocket } = await import('../hooks/usePocket');
    expect(usePocket).toBeInstanceOf(Function);
  });
});
