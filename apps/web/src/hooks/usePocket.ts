import { useState, useEffect, useCallback, useRef } from 'react'

export type SessionStatus =
  | 'created'
  | 'cloning'
  | 'cloned'
  | 'creating_branch'
  | 'ready'
  | 'working'
  | 'done'
  | 'error'

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  reasoning?: string
  timestamp?: number
}

export interface Session {
  id: string
  repoUrl: string
  task: string
  isLocal?: boolean
  localPath: string | null
  branchName: string | null
  history: Message[]
  status: SessionStatus
  isThinking?: boolean
  currentToolCall?: ToolCall | null
  pendingPermission?: {
    requestId: string
    tool: string
    args: Record<string, unknown>
    reason: string
  } | null
}

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: unknown
}

interface SessionListItem {
  id: string
  repoUrl: string
  task: string
  createdAt: number
  status: SessionStatus
}

interface PocketState {
  connected: boolean
  isConnecting: boolean
  syncing: boolean
  lastSyncTime: number | null
  session: Session | null
  sessions: SessionListItem[]
  messages: Message[]
  isLoading: boolean
  isThinking: boolean
  currentToolCall: ToolCall | null
  toolLogs: Record<string, string>
  prUrl: string | null
  error: string | null
  notification: string | null
  pendingPermission: {
    requestId: string
    tool: string
    args: Record<string, unknown>
    reason: string
  } | null
}

type ServerMessage =
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_resumed'; session: Session }
  | { type: 'session_data'; session: Session }
  | { type: 'sessions_list'; sessions: SessionListItem[] }
  | {
      type: 'status'
      status: SessionStatus
      message?: string
      localPath?: string
      branchName?: string
    }
  | { type: 'user_message'; content: string }
  | { type: 'thinking_start' }
  | { type: 'reasoning'; content: string }
  | { type: 'token'; content: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'done'; prUrl?: string | null }
  | { type: 'debug'; data: unknown }
  | { type: 'error'; error: string }
  | {
      type: 'permission_request'
      requestId: string
      tool: string
      args: Record<string, unknown>
      reason: string
    }
  | { type: 'aborted' }

export function usePocket(wsUrl: string) {
  const [state, setState] = useState<PocketState>({
    connected: false,
    isConnecting: false,
    syncing: false,
    lastSyncTime: null,
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
  })


  const pollIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const syncTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const currentSessionIdRef = useRef<string | null>(null)

  const fetchSessionsRef = useRef<() => void>(() => {})
  const fetchSessionDataRef = useRef<
    (sessionId: string, isPolling?: boolean) => void
  >(() => {})
  const startPollingRef = useRef<
    (sessionId: string, intervalMs?: number) => void
  >(() => {})

  const connect = useCallback(
    async (sessionId?: string) => {
      if (!wsUrl) return

      currentSessionIdRef.current = sessionId || null

      // Only start polling if we have a session ID
      if (!sessionId) {
        console.log('[Poll] No session ID, using polling for sessions list')
        // Fetch sessions list via polling when no session is selected
        fetchSessionsRef.current()
        setState((prev) => ({ ...prev, isConnecting: false }))
        return
      }

      console.log('[Poll] Connecting to session:', sessionId)
      setState((prev) => ({ ...prev, isConnecting: true, error: null }))

      // Fetch initial data and start polling
      try {
        console.log('[Poll] About to fetch session data')
        await fetchSessionDataRef.current(sessionId)
        console.log('[Poll] Session data fetched successfully')
        startPollingRef.current(sessionId, 5000) // 5 second interval
        setState((prev) => ({
          ...prev,
          connected: true,
          isConnecting: false,
        }))
      } catch (e) {
        console.error('[Poll] Failed to connect:', e)
        setState((prev) => ({
          ...prev,
          connected: false,
          isConnecting: false,
        }))
      }
    },
    [wsUrl],
  )

  const fetchSessions = useCallback(async () => {
    const isLocal =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    const baseUrl = isLocal
      ? ''
      : wsUrl
          .replace('ws://', 'http://')
          .replace('wss://', 'https://')
          .replace('/ws', '')
    try {
      const res = await fetch(`${baseUrl}/api/sessions`)
      if (!res.ok) {
        let errorText = await res.text()
        try {
          const json = JSON.parse(errorText)
          errorText = json.error || json.message || errorText
        } catch {
          // Not JSON, use raw text
        }
        const errorMsg = `Error ${res.status}: ${errorText}`
        console.error(`Failed to fetch sessions:`, errorMsg)
        setState((prev) => ({ ...prev, error: errorMsg }))
        return
      }
      const data = await res.json()
      if (data.type === 'sessions_list') {
        setState((prev) => ({ ...prev, sessions: data.sessions }))
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Request failed'
      console.error('Failed to fetch sessions:', e)
      setState((prev) => ({ ...prev, error: errorMsg }))
    }
  }, [wsUrl])

  const fetchSessionData = useCallback(
    async (sessionId: string, isPolling = false) => {
      const isLocal =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
      const baseUrl = isLocal
        ? ''
        : wsUrl
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')
            .replace('/ws', '')
      try {
        if (isPolling) {
          setState((prev) => ({ ...prev, syncing: true }))
        }
        const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`)
        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(`HTTP ${res.status}: ${errorText}`)
        }
        const data = await res.json()
        console.log(
          '[Poll] Fetched session data:',
          data.type,
          'status:',
          data.session?.status,
        )
        if (data.type === 'session_resumed') {
          handleServerMessage(data)
        }
        setState((prev) => ({
          ...prev,
          lastSyncTime: Date.now(),
          syncing: false,
        }))
      } catch (e) {
        console.error('[Poll] Failed to fetch session data:', e)
        setState((prev) => ({ ...prev, syncing: false }))
        throw e // Re-throw to allow caller to handle
      }
    },
    [wsUrl],
  )

  const startPolling = useCallback(
    (sessionId: string, intervalMs = 5000) => {
      console.log(
        '[Poll] Starting periodic polling for session:',
        sessionId,
        'interval:',
        intervalMs,
        'ms',
      )
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = setInterval(() => {
        const currentSessionId = new URLSearchParams(
          window.location.search,
        ).get('sessionId')
        if (currentSessionId) {
          console.log('[Poll] Periodic poll triggered')
          fetchSessionData(currentSessionId, true)
        }
      }, intervalMs)
    },
    [fetchSessionData],
  )

  const stopPolling = useCallback(() => {
    console.log('[Poll] Stopping periodic polling')
    clearInterval(pollIntervalRef.current)
    pollIntervalRef.current = undefined
  }, [])

  // Populate refs after callbacks are defined
  fetchSessionsRef.current = fetchSessions
  fetchSessionDataRef.current = fetchSessionData
  startPollingRef.current = startPolling

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'session_created':
        setState((prev) => ({
          ...prev,
          session: prev.session
            ? { ...prev.session, id: msg.sessionId }
            : ({ id: msg.sessionId } as Session),
          isLoading: false,
        }))
        // Reconnect to the specific session stream
        connect(msg.sessionId)
        break

      case 'session_resumed':
        console.log(
          '[State] Session resumed:',
          msg.session.status,
          'history length:',
          msg.session.history.length,
        )
        setState((prev) => ({
          ...prev,
          session: msg.session,
          messages: msg.session.history,
          isThinking: msg.session.isThinking ?? false,
          currentToolCall: msg.session.currentToolCall ?? null,
          isLoading:
            msg.session.status === 'working' ||
            (msg.session.isThinking ?? false) ||
            !!msg.session.currentToolCall,
          pendingPermission: msg.session.pendingPermission ?? null,
        }))
        break

      case 'session_data':
        console.log('[State] Session data update:', msg.session.status)
        setState((prev) => ({
          ...prev,
          session: msg.session,
          messages: msg.session.history,
          isThinking: msg.session.isThinking ?? prev.isThinking,
          currentToolCall: msg.session.currentToolCall ?? prev.currentToolCall,
        }))
        break

      case 'sessions_list':
        console.log('[State] Sessions list:', msg.sessions.length, 'sessions')
        setState((prev) => ({
          ...prev,
          sessions: msg.sessions,
        }))
        break

      case 'status':
        console.log(
          '[State] Status update:',
          msg.status,
          'message:',
          msg.message,
        )
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
        }))

        if (msg.message) {
          setTimeout(() => {
            setState((prev) => ({ ...prev, notification: null }))
          }, 5000)
        }
        break

      case 'user_message':
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { role: 'user', content: msg.content }],
        }))
        break

      case 'thinking_start':
        setState((prev) => ({
          ...prev,
          isThinking: true,
        }))
        break

      case 'reasoning':
        setState((prev) => {
          if (prev.messages.length > 0) {
            const lastMsg = prev.messages[prev.messages.length - 1]
            if (lastMsg.role === 'assistant') {
              return {
                ...prev,
                isThinking: false,
                messages: [
                  ...prev.messages.slice(0, -1),
                  {
                    ...lastMsg,
                    reasoning: (lastMsg.reasoning || '') + msg.content,
                  },
                ],
              }
            }
          }
          return {
            ...prev,
            isThinking: false,
            messages: [
              ...prev.messages,
              { role: 'assistant', content: '', reasoning: msg.content },
            ],
          }
        })
        break

      case 'token':
        setState((prev) => {
          if (prev.messages.length > 0) {
            const lastMsg = prev.messages[prev.messages.length - 1]
            if (lastMsg.role === 'assistant') {
              return {
                ...prev,
                isThinking: false,
                messages: [
                  ...prev.messages.slice(0, -1),
                  { ...lastMsg, content: lastMsg.content + msg.content },
                ],
              }
            }
          }
          return {
            ...prev,
            isThinking: false,
            messages: [
              ...prev.messages,
              { role: 'assistant', content: msg.content },
            ],
          }
        })
        break

      case 'tool_start':
        setState((prev) => ({
          ...prev,
          currentToolCall: { name: msg.tool, args: msg.args },
        }))
        break

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
        }))
        break

      case 'done':
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isThinking: false,
          currentToolCall: null,
          prUrl: msg.prUrl ?? prev.prUrl,
          session: prev.session ? { ...prev.session, status: 'done' } : null,
        }))
        break

      case 'debug':
        break

      case 'error':
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isThinking: false,
          error: msg.error,
        }))
        break

      case 'aborted':
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isThinking: false,
          currentToolCall: null,
        }))
        break

      case 'permission_request':
        setState((prev) => ({
          ...prev,
          pendingPermission: {
            requestId: msg.requestId,
            tool: msg.tool,
            args: msg.args,
            reason: msg.reason,
          },
        }))
        break
    }
  }, [])

  const post = useCallback(
    async (path: string, body: object) => {
      const isLocal =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
      const baseUrl = isLocal
        ? ''
        : wsUrl
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')
            .replace('/ws', '')
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          let errorText = await res.text()
          try {
            const json = JSON.parse(errorText)
            errorText = json.error || json.message || errorText
          } catch {
            // Not JSON, use raw text
          }
          const errorMsg = `Error ${res.status}: ${errorText}`
          console.error(`Post to ${path} failed:`, errorMsg)
          setState((prev) => ({ ...prev, error: errorMsg }))
          return { error: errorMsg, status: res.status }
        }

        return await res.json()
      } catch (e) {
        console.error(`Post to ${path} failed:`, e)
        const errorMsg = e instanceof Error ? e.message : 'Request failed'
        setState((prev) => ({ ...prev, error: errorMsg }))
        return { error: errorMsg }
      }
    },
    [wsUrl],
  )

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
      }))
      const data = await post('/api/sessions', { repoUrl, task, githubToken })
      if (data?.sessionId) {
        handleServerMessage(data)
      }
    },
    [post, handleServerMessage],
  )

  const listSessions = useCallback(() => {
    fetchSessions()
  }, [fetchSessions])

  const respondToPermission = useCallback(
    async (requestId: string, granted: boolean) => {
      const sessionId = state.session?.id
      if (!sessionId) return
      await post(`/api/sessions/${sessionId}/permission`, {
        requestId,
        granted,
      })
      setState((prev) => ({ ...prev, pendingPermission: null }))
    },
    [post, state.session?.id],
  )

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
      }))
      const data = await post('/api/sessions/local', { task })
      if (data?.sessionId) {
        handleServerMessage(data)
      }
    },
    [post, handleServerMessage],
  )

  const resumeSession = useCallback(
    (sessionId: string) => {
      setState((prev) => ({ ...prev, isLoading: true }))
      connect(sessionId)
    },
    [connect],
  )

  const clone = useCallback(
    (sessionId: string) => {
      console.log('[Action] Clone started for session:', sessionId)
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      // Ensure polling is active during long-running operation
      startPolling(sessionId, 10000)
      post(`/api/sessions/${sessionId}/clone`, {}).catch((e) => {
        console.error('[Action] Clone failed:', e)
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: e.message || 'Clone failed',
        }))
      })
    },
    [post, startPolling],
  )

  const createBranch = useCallback(
    (sessionId: string) => {
      console.log('[Action] Create branch started for session:', sessionId)
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      // Ensure polling is active during long-running operation
      startPolling(sessionId, 10000)
      post(`/api/sessions/${sessionId}/create_branch`, {}).catch((e) => {
        console.error('[Action] Create branch failed:', e)
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: e.message || 'Branch creation failed',
        }))
      })
    },
    [post, startPolling],
  )

  const sendMessage = useCallback(
    (sessionId: string, content: string, model?: string) => {
      setState((prev) => ({ ...prev, isLoading: true }))
      post(`/api/sessions/${sessionId}/chat`, { content, model })
    },
    [post],
  )

  const disconnect = useCallback(() => {
    console.log('[Poll] Disconnecting')
    stopPolling()
    setState((prev) => ({ ...prev, connected: false, isConnecting: false }))
  }, [stopPolling])

  const commit = useCallback(
    (sessionId: string) => {
      post(`/api/sessions/${sessionId}/commit`, {})
    },
    [post],
  )

  const createPR = useCallback(
    (sessionId: string) => {
      post(`/api/sessions/${sessionId}/create_pr`, {})
    },
    [post],
  )

  useEffect(() => {
    if (!wsUrl) return

    // On mount, if we have a session in the URL (handled by parent usually), we connect to it.
    // Otherwise we rely on polling for the sessions list.
    const searchParams = new URLSearchParams(window.location.search)
    const sessionId = searchParams.get('sessionId')

    connect(sessionId || undefined)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Visibility] Tab became visible, fetching latest status')
        const currentSessionId = new URLSearchParams(
          window.location.search,
        ).get('sessionId')
        if (currentSessionId) {
          // Immediately fetch latest status when tab becomes visible
          fetchSessionData(currentSessionId, true)
          // Restart polling if not already running
          startPolling(currentSessionId, 10000)
        }
        connect(currentSessionId || undefined)
      } else {
        console.log('[Visibility] Tab hidden')
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      console.log('[Effect] Cleaning up usePocket')
      disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearInterval(pollIntervalRef.current)
      clearTimeout(syncTimeoutRef.current)
    }
  }, [connect, disconnect, wsUrl, fetchSessionData, startPolling])

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
      setState((prev) => ({ ...prev, isLoading: true }))
      post(`/api/sessions/${sessionId}/chat`, { isPreSetup: true })
    },
    disconnect,
  }
}
