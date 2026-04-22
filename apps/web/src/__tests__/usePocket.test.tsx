import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePocket } from '../hooks/usePocket';

class MockWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  send = vi.fn();
  close = vi.fn();
}

describe('usePocket Hook', () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    mockWs = new MockWebSocket();
    const MockConstructor = vi.fn(() => mockWs) as any;
    MockConstructor.OPEN = 1;
    global.WebSocket = MockConstructor;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('should set isThinking=true on thinking_start message', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    expect(mockWs.onmessage).not.toBeNull();

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'thinking_start' }) });
    });

    expect(result.current.isThinking).toBe(true);
  });

  it('should set isThinking=false on reasoning token', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'thinking_start' }) });
    });

    expect(result.current.isThinking).toBe(true);

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'reasoning', content: 'Let me think...' }) });
    });

    expect(result.current.isThinking).toBe(false);
  });

  it('should set isThinking=false on content token', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'thinking_start' }) });
    });

    expect(result.current.isThinking).toBe(true);

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'token', content: 'Hello' }) });
    });

    expect(result.current.isThinking).toBe(false);
  });

  it('should append reasoning to existing assistant message', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'token', content: 'Answer' }) });
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'reasoning', content: 'Because...' }) });
    });

    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.reasoning).toBe('Because...');
    expect(lastMsg.content).toBe('Answer');
  });

  it('should create assistant message for reasoning if last was user', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'user_message', content: 'Hello' }) });
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'reasoning', content: 'Let me think' }) });
    });

    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.reasoning).toBe('Let me think');
    expect(lastMsg.content).toBe('');
  });

  it('should clear isThinking on done', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'thinking_start' }) });
    });

    expect(result.current.isThinking).toBe(true);

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'done' }) });
    });

    expect(result.current.isThinking).toBe(false);
  });

  it('should clear isThinking on error', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'thinking_start' }) });
    });

    expect(result.current.isThinking).toBe(true);

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'error', error: 'Something went wrong' }) });
    });

    expect(result.current.isThinking).toBe(false);
  });

  it('should clear isThinking on aborted', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'thinking_start' }) });
    });

    expect(result.current.isThinking).toBe(true);

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'aborted' }) });
    });

    expect(result.current.isThinking).toBe(false);
  });

  it('should not connect when wsUrl is empty', async () => {
    const { result } = renderHook(() => usePocket(''));
    expect(result.current.connected).toBe(false);
  });

  it('should connect when wsUrl is provided', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));
    act(() => {
      mockWs.onopen?.();
    });
    expect(result.current.connected).toBe(true);
  });

  it('should set isLoading=false when status is ready', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'ready', message: 'Ready!' }) });
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('should set isLoading=false when status is done', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'done' }) });
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('should set isLoading=false when status is error', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'error' }) });
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('should set isLoading=true when status is cloning', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'cloning', message: 'Cloning...' }) });
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('should set isLoading=true when status is creating_branch', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'creating_branch' }) });
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('should set isLoading=true when status is working', async () => {
    const { result } = renderHook(() => usePocket('ws://localhost:5173'));

    act(() => {
      mockWs.onopen?.();
    });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'status', status: 'working', message: 'Working...' }) });
    });

    expect(result.current.isLoading).toBe(true);
  });
});