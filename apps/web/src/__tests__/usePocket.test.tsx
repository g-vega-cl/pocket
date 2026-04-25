import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePocket } from '../hooks/usePocket';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('usePocket Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'session_created', sessionId: 'test-session' }),
      text: async () => 'OK',
    });
  });
  it('should be defined', async () => {
    const { usePocket } = await import('../hooks/usePocket');
    expect(usePocket).toBeDefined();
  });

  it('should return an object with expected methods', async () => {
    const { usePocket } = await import('../hooks/usePocket');
    expect(usePocket).toBeInstanceOf(Function);
  });

  it('should not connect when wsUrl is empty', () => {
    const { result } = renderHook(() => usePocket(''));
    expect(result.current.connected).toBe(false);
  });

  it('should expose commit method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.commit).toBeDefined();
    expect(result.current.commit).toBeInstanceOf(Function);
  });

  it('should expose createPR method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.createPR).toBeDefined();
    expect(result.current.createPR).toBeInstanceOf(Function);
  });

  it('should expose listSessions method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.listSessions).toBeDefined();
    expect(result.current.listSessions).toBeInstanceOf(Function);
  });

  it('should expose clone method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.clone).toBeDefined();
    expect(result.current.clone).toBeInstanceOf(Function);
  });

  it('should expose createBranch method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.createBranch).toBeDefined();
    expect(result.current.createBranch).toBeInstanceOf(Function);
  });

  it('should expose sendMessage method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.sendMessage).toBeDefined();
    expect(result.current.sendMessage).toBeInstanceOf(Function);
  });

  describe('Initial State', () => {
    it('should have connected initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.connected).toBe(false);
    });

    it('should have syncing initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.syncing).toBe(false);
    });

    it('should have lastSyncTime initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.lastSyncTime).toBeNull();
    });

    it('should have session initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.session).toBeNull();
    });

    it('should have sessions initialized to empty array', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.sessions).toEqual([]);
    });

    it('should have messages initialized to empty array', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.messages).toEqual([]);
    });

    it('should have isLoading initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.isLoading).toBe(false);
    });

    it('should have isThinking initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.isThinking).toBe(false);
    });

  it('should have error initialized to null', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    expect(result.current.error).toBeNull();
  });

  describe('Error Handling', () => {
    it('should set error message for failed HTTP requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      
      // Trigger a post request
      await act(async () => {
        await result.current.createSession('https://github.com/test/repo', 'test task');
      });

      await waitFor(() => {
        expect(result.current.error).toContain('Error 429');
      });
    });

    it('should parse JSON error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: 'Internal Server Error', message: 'Something went wrong' }),
      });

      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      
      await act(async () => {
        await result.current.createSession('https://github.com/test/repo', 'test task');
      });

      await waitFor(() => {
        expect(result.current.error).toContain('Error 500');
        expect(result.current.error).toContain('Internal Server Error');
      });
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      
      await act(async () => {
        await result.current.createSession('https://github.com/test/repo', 'test task');
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Network failure');
      });
    });
  });

    it('should have prUrl initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.prUrl).toBeNull();
    });

    it('should have notification initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.notification).toBeNull();
    });

    it('should have pendingPermission initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'));
      expect(result.current.pendingPermission).toBeNull();
    });
  });
});