import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePocket } from '../hooks/usePocket';

describe('usePocket Hook', () => {
  it('should be defined', async () => {
    const { usePocket } = await import('../hooks/usePocket');
    expect(usePocket).toBeDefined();
  });

  it('should return an object with expected methods', async () => {
    const { usePocket } = await import('../hooks/usePocket');
    expect(usePocket).toBeInstanceOf(Function);
  });

  it('should expose commit and createPR methods', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.commit).toBeDefined();
    expect(result.current.commit).toBeInstanceOf(Function);
    expect(result.current.createPR).toBeDefined();
    expect(result.current.createPR).toBeInstanceOf(Function);
  });

  it('should expose listSessions method and sessions state', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.listSessions).toBeDefined();
    expect(result.current.listSessions).toBeInstanceOf(Function);
    expect(result.current.sessions).toBeInstanceOf(Array);
  });
});