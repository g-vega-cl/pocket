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

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (!wsUrl) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
      ws.send(JSON.stringify({ type: 'list_sessions' }));
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connect, 1000); // Faster reconnect
    };

    ws.onerror = () => {
      setState((prev) => ({ ...prev, error: 'Connection error' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    wsRef.current = ws;
  }, [wsUrl]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'session_created':
        setState((prev) => ({
          ...prev,
          session: { ...prev.session!, id: msg.sessionId } as Session,
          isLoading: false,
        }));
        break;

      case 'session_resumed':
        setState((prev) => ({
          ...prev,
          session: msg.session,
          messages: msg.session.history,
          isThinking: msg.session.isThinking ?? false,
          currentToolCall: msg.session.currentToolCall ?? null,
          isLoading: msg.session.status === 'working' || (msg.session.isThinking ?? false) || !!msg.session.currentToolCall,
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

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const createSession = useCallback(
    (repoUrl: string, task: string, githubToken?: string) => {
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
      send({ type: 'create_session', payload: { repoUrl, task, githubToken } });
    },
    [send]
  );

  const listSessions = useCallback(() => {
    send({ type: 'list_sessions' });
  }, [send]);

  const respondToPermission = useCallback(
    (requestId: string, granted: boolean) => {
      send({ type: 'permission_response', payload: { requestId, granted } });
      setState((prev) => ({ ...prev, pendingPermission: null }));
    },
    [send]
  );

  const createLocalSession = useCallback(
    (task: string) => {
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
      send({ type: 'create_local_session', payload: { task } });
    },
    [send]
  );

  const resumeSession = useCallback(
    (sessionId: string) => {
      setState((prev) => ({ ...prev, isLoading: true }));
      send({ type: 'resume_session', sessionId });
    },
    [send]
  );

  const clone = useCallback(
    (sessionId: string) => {
      send({ type: 'clone', sessionId });
    },
    [send]
  );

  const createBranch = useCallback(
    (sessionId: string) => {
      send({ type: 'create_branch', sessionId });
    },
    [send]
  );

  const sendMessage = useCallback(
    (sessionId: string, content: string, model?: string) => {
      setState((prev) => ({ ...prev, isLoading: true }));
      send({ type: 'chat', sessionId, payload: { content, model } });
    },
    [send]
  );

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimeoutRef.current);
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const commit = useCallback(
    (sessionId: string) => {
      send({ type: 'commit', sessionId });
    },
    [send]
  );

  const createPR = useCallback(
    (sessionId: string) => {
      send({ type: 'create_pr', sessionId });
    },
    [send]
  );

  useEffect(() => {
    if (!wsUrl) return;
    connect();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        connect();
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
      send({ type: 'pre_setup', sessionId });
    },
    disconnect,
  };
}
