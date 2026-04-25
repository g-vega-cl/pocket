import { useState, useEffect, useCallback, useRef } from 'react';

export type SessionStatus =
  | 'created'
  | 'cloning'
  | 'cloned'
  | 'creating_branch'
  | 'ready'
  | 'working'
  | 'done'
  | 'error';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  reasoning?: string;
  timestamp?: number;
}

export interface Session {
  id: string;
  repoUrl: string;
  task: string;
  isLocal?: boolean;
  localPath: string | null;
  branchName: string | null;
  history: Message[];
  status: SessionStatus;
  isThinking?: boolean;
  currentToolCall?: ToolCall | null;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

interface SessionListItem {
  id: string;
  repoUrl: string;
  task: string;
  createdAt: number;
  status: SessionStatus;
}

interface PocketState {
  connected: boolean;
  session: Session | null;
  sessions: SessionListItem[];
  messages: Message[];
  isLoading: boolean;
  isThinking: boolean;
  currentToolCall: ToolCall | null;
  toolLogs: Record<string, string>;
  prUrl: string | null;
  error: string | null;
  notification: string | null;
  pendingPermission: {
    requestId: string;
    tool: string;
    args: Record<string, unknown>;
    reason: string;
  } | null;
}

type ServerMessage =
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_resumed'; session: Session }
  | { type: 'session_data'; session: Session }
  | { type: 'sessions_list'; sessions: SessionListItem[] }
  | { type: 'status'; status: SessionStatus; message?: string; localPath?: string; branchName?: string }
  | { type: 'user_message'; content: string }
  | { type: 'thinking_start' }
  | { type: 'reasoning'; content: string }
  | { type: 'token'; content: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'done'; prUrl?: string | null }
  | { type: 'debug'; data: unknown }
  | { type: 'error'; error: string }
  | { type: 'permission_request'; requestId: string; tool: string; args: Record<string, unknown>; reason: string }
  | { type: 'aborted' };

export function usePocket(wsUrl: string) {
  const [state, setState] = useState<PocketState>({
    connected: false,
    session: null,
    sessions: [],
    messages: [],
    isLoading: false,
    isThinking: false,
    currentToolCall: null,
    toolLogs: {},
    prUrl: null,
    error: null,
    notification: null,
    pendingPermission: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback((sessionId?: string) => {
    if (!wsUrl) return;
    if (eventSourceRef.current) eventSourceRef.current.close();

    // In local dev, wsUrl is typically "ws://localhost:3000/ws" (proxied to 5173)
    // We want our API calls to go through the same origin to use the proxy
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isLocal ? '' : wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');

    const eventsUrl = sessionId
      ? `${baseUrl}/api/sessions/${sessionId}/events`
      : `${baseUrl}/api/sessions/global/events`;

    const es = new EventSource(eventsUrl);

    es.onopen = () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
      // Fetch initial data
      fetchSessions();
      if (sessionId) {
        fetchSessionData(sessionId);
      }
    };

    es.onerror = (e) => {
      console.error('SSE Error:', e);
      setState((prev) => ({ ...prev, connected: false }));
      es.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => connect(sessionId), 2000);
    };

    es.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    eventSourceRef.current = es;
  }, [wsUrl]);

  const fetchSessions = useCallback(async () => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isLocal ? '' : wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');
    try {
      const res = await fetch(`${baseUrl}/api/sessions`);
      const data = await res.json();
      if (data.type === 'sessions_list') {
        setState(prev => ({ ...prev, sessions: data.sessions }));
      }
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    }
  }, [wsUrl]);

  const fetchSessionData = useCallback(async (sessionId: string) => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isLocal ? '' : wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');
    try {
      const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
      const data = await res.json();
      if (data.type === 'session_resumed') {
        handleServerMessage(data);
      }
    } catch (e) {
      console.error('Failed to fetch session data:', e);
    }
  }, [wsUrl]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'session_created':
        setState((prev) => ({
          ...prev,
          session: prev.session ? { ...prev.session, id: msg.sessionId } : { id: msg.sessionId } as Session,
          isLoading: false,
        }));
        // Reconnect to the specific session stream
        connect(msg.sessionId);
        break;

      case 'session_resumed':
        setState((prev) => ({
          ...prev,
          session: msg.session,
          messages: msg.session.history,
          isThinking: msg.session.isThinking ?? false,
          currentToolCall: msg.session.currentToolCall ?? null,
          isLoading: msg.session.status === 'working' || (msg.session.isThinking ?? false) || !!msg.session.currentToolCall,
          pendingPermission: msg.session.pendingPermission ?? null,
        }));
        break;

      case 'session_data':
        setState((prev) => ({
          ...prev,
          session: msg.session,
          messages: msg.session.history,
          isThinking: msg.session.isThinking ?? prev.isThinking,
          currentToolCall: msg.session.currentToolCall ?? prev.currentToolCall,
        }));
        break;

      case 'sessions_list':
        setState((prev) => ({
          ...prev,
          sessions: msg.sessions,
        }));
        break;

      case 'status':
        setState((prev) => ({
          ...prev,
          session: prev.session
            ? {
                ...prev.session,
                status: msg.status,
                localPath: msg.localPath ?? prev.session.localPath,
                branchName: msg.branchName ?? prev.session.branchName,
              }
            : null,
          isLoading: !['ready', 'done', 'error'].includes(msg.status),
          notification: msg.message ?? null,
        }));

        if (msg.message) {
          setTimeout(() => {
            setState((prev) => ({ ...prev, notification: null }));
          }, 5000);
        }
        break;

      case 'user_message':
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { role: 'user', content: msg.content }],
        }));
        break;

      case 'thinking_start':
        setState((prev) => ({
          ...prev,
          isThinking: true,
        }));
        break;

      case 'reasoning':
        setState((prev) => {
          if (prev.messages.length > 0) {
            const lastMsg = prev.messages[prev.messages.length - 1];
            if (lastMsg.role === 'assistant') {
              return {
                ...prev,
                isThinking: false,
                messages: [
                  ...prev.messages.slice(0, -1),
                  { ...lastMsg, reasoning: (lastMsg.reasoning || '') + msg.content },
                ],
              };
            }
          }
          return {
            ...prev,
            isThinking: false,
            messages: [...prev.messages, { role: 'assistant', content: '', reasoning: msg.content }],
          };
        });
        break;

      case 'token':
        setState((prev) => {
          if (prev.messages.length > 0) {
            const lastMsg = prev.messages[prev.messages.length - 1];
            if (lastMsg.role === 'assistant') {
              return {
                ...prev,
                isThinking: false,
                messages: [
                  ...prev.messages.slice(0, -1),
                  { ...lastMsg, content: lastMsg.content + msg.content },
                ],
              };
            }
          }
          return {
            ...prev,
            isThinking: false,
            messages: [...prev.messages, { role: 'assistant', content: msg.content }],
          };
        });
        break;

      case 'tool_start':
        setState((prev) => ({
          ...prev,
          currentToolCall: { name: msg.tool, args: msg.args },
        }));
        break;

      case 'tool_result':
        setState((prev) => ({
          ...prev,
          currentToolCall: prev.currentToolCall
            ? { ...prev.currentToolCall, result: msg.result }
            : null,
          messages: [
            ...prev.messages,
            {
              role: 'tool' as const,
              content: JSON.stringify(msg.result),
            },
          ],
          isLoading: false,
        }));
        break;

      case 'done':
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isThinking: false,
          currentToolCall: null,
          prUrl: msg.prUrl ?? prev.prUrl,
          session: prev.session ? { ...prev.session, status: 'done' } : null,
        }));
        break;

      case 'debug':
        break;

      case 'error':
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isThinking: false,
          error: msg.error,
        }));
        break;

      case 'aborted':
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isThinking: false,
          currentToolCall: null,
        }));
        break;

      case 'permission_request':
        setState((prev) => ({
          ...prev,
          pendingPermission: {
            requestId: msg.requestId,
            tool: msg.tool,
            args: msg.args,
            reason: msg.reason,
          },
        }));
        break;
    }
  }, []);

  const post = useCallback(async (path: string, body: object) => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isLocal ? '' : wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (e) {
      console.error(`Post to ${path} failed:`, e);
      setState(prev => ({ ...prev, error: 'Request failed' }));
    }
  }, [wsUrl]);

  const createSession = useCallback(
    async (repoUrl: string, task: string, githubToken?: string) => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        session: {
          id: '',
          repoUrl,
          task,
          localPath: null,
          branchName: null,
          history: [],
          status: 'created',
        },
        messages: [],
        error: null,
      }));
      const data = await post('/api/sessions', { repoUrl, task, githubToken });
      if (data?.sessionId) {
        handleServerMessage(data);
      }
    },
    [post, handleServerMessage]
  );

  const listSessions = useCallback(() => {
    fetchSessions();
  }, [fetchSessions]);

  const respondToPermission = useCallback(
    async (requestId: string, granted: boolean) => {
      const sessionId = state.session?.id;
      if (!sessionId) return;
      await post(`/api/sessions/${sessionId}/permission`, { requestId, granted });
      setState((prev) => ({ ...prev, pendingPermission: null }));
    },
    [post, state.session?.id]
  );

  const createLocalSession = useCallback(
    async (task: string) => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        session: {
          id: '',
          repoUrl: 'local',
          task,
          isLocal: true,
          localPath: null,
          branchName: null,
          history: [],
          status: 'created',
        },
        messages: [],
        error: null,
      }));
      const data = await post('/api/sessions/local', { task });
      if (data?.sessionId) {
        handleServerMessage(data);
      }
    },
    [post, handleServerMessage]
  );

  const resumeSession = useCallback(
    (sessionId: string) => {
      setState((prev) => ({ ...prev, isLoading: true }));
      connect(sessionId);
    },
    [connect]
  );

  const clone = useCallback(
    (sessionId: string) => {
      post(`/api/sessions/${sessionId}/clone`, {});
    },
    [post]
  );

  const createBranch = useCallback(
    (sessionId: string) => {
      post(`/api/sessions/${sessionId}/create_branch`, {});
    },
    [post]
  );

  const sendMessage = useCallback(
    (sessionId: string, content: string, model?: string) => {
      setState((prev) => ({ ...prev, isLoading: true }));
      post(`/api/sessions/${sessionId}/chat`, { content, model });
    },
    [post]
  );

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimeoutRef.current);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const commit = useCallback(
    (sessionId: string) => {
      post(`/api/sessions/${sessionId}/commit`, {});
    },
    [post]
  );

  const createPR = useCallback(
    (sessionId: string) => {
      post(`/api/sessions/${sessionId}/create_pr`, {});
    },
    [post]
  );

  useEffect(() => {
    if (!wsUrl) return;

    // On mount, if we have a session in the URL (handled by parent usually), we connect to it.
    // Otherwise we connect to global stream.
    const searchParams = new URLSearchParams(window.location.search);
    const sessionId = searchParams.get('sessionId');

    connect(sessionId || undefined);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const currentSessionId = new URLSearchParams(window.location.search).get('sessionId');
        connect(currentSessionId || undefined);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connect, disconnect, wsUrl]);

  return {
    ...state,
    createSession,
    createLocalSession,
    resumeSession,
    listSessions,
    respondToPermission,
    clone,
    createBranch,
    sendMessage,
    commit,
    createPR,
    preSetup: (sessionId: string) => {
      setState((prev) => ({ ...prev, isLoading: true }));
      post(`/api/sessions/${sessionId}/chat`, { isPreSetup: true });
    },
    disconnect,
  };
}
