import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePocket } from '../hooks/usePocket'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('usePocket Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'session_created',
        sessionId: 'test-session',
      }),
      text: async () => 'OK',
    })
  })
  it('should be defined', async () => {
    const { usePocket } = await import('../hooks/usePocket')
    expect(usePocket).toBeDefined()
  })

  it('should return an object with expected methods', async () => {
    const { usePocket } = await import('../hooks/usePocket')
    expect(usePocket).toBeInstanceOf(Function)
  })

  it('should not connect when wsUrl is empty', () => {
    const { result } = renderHook(() => usePocket(''))
    expect(result.current.connected).toBe(false)
  })

  it('should expose commit method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'))
    expect(result.current.commit).toBeDefined()
    expect(result.current.commit).toBeInstanceOf(Function)
  })

  it('should expose createPR method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'))
    expect(result.current.createPR).toBeDefined()
    expect(result.current.createPR).toBeInstanceOf(Function)
  })

  it('should expose listSessions method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'))
    expect(result.current.listSessions).toBeDefined()
    expect(result.current.listSessions).toBeInstanceOf(Function)
  })

  it('should expose clone method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'))
    expect(result.current.clone).toBeDefined()
    expect(result.current.clone).toBeInstanceOf(Function)
  })

  it('should expose createBranch method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'))
    expect(result.current.createBranch).toBeDefined()
    expect(result.current.createBranch).toBeInstanceOf(Function)
  })

  it('should expose sendMessage method', () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'))
    expect(result.current.sendMessage).toBeDefined()
    expect(result.current.sendMessage).toBeInstanceOf(Function)
  })

  describe('Initial State', () => {
    it('should have connected initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.connected).toBe(false)
    })

    it('should have syncing initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.syncing).toBe(false)
    })

    it('should have lastSyncTime initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.lastSyncTime).toBeNull()
    })

    it('should have session initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.session).toBeNull()
    })

    it('should have sessions initialized to empty array', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.sessions).toEqual([])
    })

    it('should have messages initialized to empty array', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.messages).toEqual([])
    })

    it('should have isLoading initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.isLoading).toBe(false)
    })

    it('should have isThinking initialized to false', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.isThinking).toBe(false)
    })

    it('should have error initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.error).toBeNull()
    })

    describe('Error Handling', () => {
      it('should set error message for failed HTTP requests', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'Too Many Requests',
        })

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        // Trigger a post request
        await act(async () => {
          await result.current.createSession(
            'https://github.com/test/repo',
            'test task',
          )
        })

        await waitFor(() => {
          expect(result.current.error).toContain('Error 429')
        })
      })

      it('should parse JSON error responses', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () =>
            JSON.stringify({
              error: 'Internal Server Error',
              message: 'Something went wrong',
            }),
        })

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        await act(async () => {
          await result.current.createSession(
            'https://github.com/test/repo',
            'test task',
          )
        })

        await waitFor(() => {
          expect(result.current.error).toContain('Error 500')
          expect(result.current.error).toContain('Internal Server Error')
        })
      })

      it('should handle network errors gracefully', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network failure'))

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        await act(async () => {
          await result.current.createSession(
            'https://github.com/test/repo',
            'test task',
          )
        })

        await waitFor(() => {
          expect(result.current.error).toBe('Network failure')
        })
      })
    })

    it('should have prUrl initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.prUrl).toBeNull()
    })

    it('should have notification initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.notification).toBeNull()
    })

    it('should have pendingPermission initialized to null', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))
      expect(result.current.pendingPermission).toBeNull()
    })
  })

  describe('SSE Connection Behavior', () => {
    let mockEventSource: any
    let eventSourceConstructorSpy: any

    beforeEach(() => {
      // Mock EventSource
      mockEventSource = {
        onopen: null,
        onerror: null,
        onmessage: null,
        close: vi.fn(),
      }
      eventSourceConstructorSpy = vi.fn(() => mockEventSource)
      // @ts-ignore - Mocking global EventSource
      global.EventSource = eventSourceConstructorSpy
      
      // Reset window.location.search to empty
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
        configurable: true,
      })
    })

    it('should not connect to SSE when no session ID is provided', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))

      // EventSource should not be constructed
      expect(eventSourceConstructorSpy).not.toHaveBeenCalled()
      // connected should be false
      expect(result.current.connected).toBe(false)
    })

    it('should connect to session-specific SSE when session ID is in URL', () => {
      // Mock URL to include session ID
      Object.defineProperty(window, 'location', {
        value: { search: '?sessionId=test-session-123' },
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => usePocket('ws://localhost:5173'))

      // EventSource should be constructed with session-specific URL
      // In local dev mode, baseUrl is empty string, so URL should be relative
      expect(eventSourceConstructorSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/test-session-123/events')
      )
      // connected should be false initially (until connection opens)
      expect(result.current.connected).toBe(false)
    })

    it('should not attempt to connect to non-existent global stream endpoint', () => {
      const { result } = renderHook(() => usePocket('ws://localhost:5173'))

      // Verify no EventSource was created
      expect(eventSourceConstructorSpy).not.toHaveBeenCalled()
      // Verify no attempt to connect to global stream
      expect(eventSourceConstructorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/global/events')
      )
    })

    it('should fetch sessions list when no session ID is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'sessions_list',
          sessions: [
            { id: 'session-1', repoUrl: 'https://github.com/test/repo1', task: 'Task 1', createdAt: Date.now(), status: 'ready' },
            { id: 'session-2', repoUrl: 'https://github.com/test/repo2', task: 'Task 2', createdAt: Date.now(), status: 'working' },
          ],
        }),
        text: async () => 'OK',
      })

      const { result } = renderHook(() => usePocket('ws://localhost:5173'))

      await waitFor(() => {
        expect(result.current.sessions).toHaveLength(2)
      })
    })

    it('should fetch sessions list when listSessions is called', async () => {
      // First call during mount
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'sessions_list',
          sessions: [
            { id: 'session-1', repoUrl: 'https://github.com/test/repo1', task: 'Task 1', createdAt: Date.now(), status: 'ready' },
          ],
        }),
        text: async () => 'OK',
      })
      // Second call when listSessions is called
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'sessions_list',
          sessions: [
            { id: 'session-1', repoUrl: 'https://github.com/test/repo1', task: 'Task 1', createdAt: Date.now(), status: 'ready' },
          ],
        }),
        text: async () => 'OK',
      })

      const { result } = renderHook(() => usePocket('ws://localhost:5173'))

      await act(async () => {
        result.current.listSessions()
      })

      await waitFor(() => {
        expect(result.current.sessions).toHaveLength(1)
      })
    })

    it('should handle SSE connection errors gracefully', () => {
      // Mock URL to include session ID
      Object.defineProperty(window, 'location', {
        value: { search: '?sessionId=test-session-456' },
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => usePocket('ws://localhost:5173'))

      // Simulate connection error
      act(() => {
        mockEventSource.onerror(new Event('error'))
      })

      // connected should be false after error
      expect(result.current.connected).toBe(false)
    })

    // Tests for isConnecting state
    describe('isConnecting state', () => {
      it('should not set isConnecting when no session ID is provided', () => {
        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        // isConnecting should remain false
        expect(result.current.isConnecting).toBe(false)
      })

      it('should set isConnecting=true when attempting to connect to session', () => {
        // Mock URL to include session ID
        Object.defineProperty(window, 'location', {
          value: { search: '?sessionId=test-session-connect' },
          writable: true,
          configurable: true,
        })

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        // isConnecting should be true during connection attempt
        expect(result.current.isConnecting).toBe(true)
      })

      it('should set isConnecting=false on successful connection', () => {
        // Mock URL to include session ID
        Object.defineProperty(window, 'location', {
          value: { search: '?sessionId=test-session-success' },
          writable: true,
          configurable: true,
        })

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        // Initially isConnecting should be true
        expect(result.current.isConnecting).toBe(true)

        // Simulate successful connection
        act(() => {
          mockEventSource.onopen(new Event('open'))
        })

        // isConnecting should be false, connected should be true
        expect(result.current.isConnecting).toBe(false)
        expect(result.current.connected).toBe(true)
      })

      it('should set isConnecting=false on connection error', () => {
        // Mock URL to include session ID
        Object.defineProperty(window, 'location', {
          value: { search: '?sessionId=test-session-error' },
          writable: true,
          configurable: true,
        })

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        // Initially isConnecting should be true
        expect(result.current.isConnecting).toBe(true)

        // Simulate connection error
        act(() => {
          mockEventSource.onerror(new Event('error'))
        })

        // isConnecting should be false after error
        expect(result.current.isConnecting).toBe(false)
        expect(result.current.connected).toBe(false)
      })

      it('should clear isConnecting on disconnect', () => {
        // Mock URL to include session ID
        Object.defineProperty(window, 'location', {
          value: { search: '?sessionId=test-session-disconnect' },
          writable: true,
          configurable: true,
        })

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        // Initially isConnecting should be true
        expect(result.current.isConnecting).toBe(true)

        // Simulate disconnect
        act(() => {
          result.current.disconnect()
        })

        // isConnecting should be false
        expect(result.current.isConnecting).toBe(false)
      })

      it('should set isConnecting=true on retry attempt after error', async () => {
        // Mock URL to include session ID
        Object.defineProperty(window, 'location', {
          value: { search: '?sessionId=test-session-retry' },
          writable: true,
          configurable: true,
        })

        const { result } = renderHook(() => usePocket('ws://localhost:5173'))

        // Initially isConnecting should be true
        expect(result.current.isConnecting).toBe(true)

        // Simulate connection error
        act(() => {
          mockEventSource.onerror(new Event('error'))
        })

        // isConnecting should be false after error
        expect(result.current.isConnecting).toBe(false)

        // Wait for retry timeout (2 seconds)
        await new Promise(resolve => setTimeout(resolve, 2100))

        // isConnecting should be true again during retry
        expect(result.current.isConnecting).toBe(true)
      })
    })
  })
})
