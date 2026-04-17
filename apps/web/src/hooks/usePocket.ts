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
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Session {
  id: string;
  repoUrl: string;
  task: string;
  localPath: string | null;
  branchName: string | null;
  history: Message[];
  status: SessionStatus;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

interface PocketState {
  connected: boolean;
  session: Session | null;
  messages: Message[];
  isLoading: boolean;
  currentToolCall: ToolCall | null;
  prUrl: string | null;
  error: string | null;
}

type ServerMessage =
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_resumed'; session: Session }
  | { type: 'session_data'; session: Session }
  | { type: 'status'; status: SessionStatus; message?: string; localPath?: string; branchName?: string }
  | { type: 'user_message'; content: string }
  | { type: 'token'; content: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'done'; prUrl?: string | null }
  | { type: 'debug'; data: unknown }
  | { type: 'error'; error: string }
  | { type: 'aborted' };

export function usePocket(wsUrl: string) {
  const [state, setState] = useState<PocketState>({
    connected: false,
    session: null,
    messages: [],
    isLoading: false,
    currentToolCall: null,
    prUrl: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (!wsUrl) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
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
        }));
        break;

      case 'session_resumed':
        setState((prev) => ({
          ...prev,
          session: msg.session,
          messages: msg.session.history,
        }));
        break;

      case 'session_data':
        setState((prev) => ({
          ...prev,
          session: msg.session,
          messages: msg.session.history,
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
          isLoading: ['cloning', 'creating_branch'].includes(msg.status),
        }));
        break;

      case 'user_message':
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { role: 'user', content: msg.content }],
        }));
        break;

      case 'token':
        setState((prev) => {
          const lastMsg = prev.messages[prev.messages.length - 1];
          if (lastMsg?.role === 'assistant') {
            return {
              ...prev,
              messages: [
                ...prev.messages.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + msg.content },
              ],
            };
          }
          return {
            ...prev,
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
              role: 'system' as const,
              content: `Tool ${msg.tool} result: ${JSON.stringify(msg.result)}`,
            },
          ],
        }));
        break;

      case 'done':
        setState((prev) => ({
          ...prev,
          isLoading: false,
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
          error: msg.error,
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
    (repoUrl: string, task: string) => {
      send({ type: 'create_session', payload: { repoUrl, task } });
      setState((prev) => ({
        ...prev,
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
    },
    [send]
  );

  const resumeSession = useCallback(
    (sessionId: string) => {
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
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
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
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    ...state,
    createSession,
    resumeSession,
    clone,
    createBranch,
    sendMessage,
    commit,
    createPR,
    disconnect,
  };
}
