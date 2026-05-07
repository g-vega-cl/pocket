import { useState, useCallback, useRef } from 'react'
import { useSessionStream } from './useSessionStream.js'
import { reduceEvents } from '#/features/session/state/events.js'
import type { Event, ChatState } from '#/features/session/state/events.js'
import { api } from '#/shared/api/client.js'
import type { SessionDetail, SessionListItem } from '#/shared/api/client.js'

export function usePocketSession(sessionId: string | null) {
  const [chatState, setChatState] = useState<ChatState>({
    messages: [],
    pendingPermissions: [],
    status: 'creating',
    isThinking: false,
    error: null,
    lastSeq: 0,
    tokenUsage: null,
    contextWindow: 128000,
  })
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const eventLogRef = useRef<Event[]>([])

  const handleEvents = useCallback((newEvents: Event[]) => {
    eventLogRef.current = [...eventLogRef.current, ...newEvents]
    const state = reduceEvents(eventLogRef.current)
    setChatState(state)
  }, [])

  const { connected } = useSessionStream({
    sessionId: sessionId ?? '',
    onEvents: handleEvents,
    enabled: !!sessionId,
  })

  const loadSessions = useCallback(async () => {
    try {
      const result = await api.listSessions()
      setSessions(result.sessions)
    } catch {
      // silently fail
    }
  }, [])

  const loadSession = useCallback(async (id: string) => {
    try {
      const detail = await api.getSession(id)
      setSession(detail)
      // Reset event log when loading a new session
      eventLogRef.current = []
    } catch {
      // silently fail
    }
  }, [])

  const createSession = useCallback(async (input: {
    repoUrl: string
    task: string
    model: string
    githubToken?: string
    isLocal?: boolean
  }) => {
    const result = await api.createSession(input)
    await loadSessions()
    return result
  }, [loadSessions])

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId) return
    await api.sendMessage(sessionId, content)
  }, [sessionId])

  const abort = useCallback(async () => {
    if (!sessionId) return
    await api.abortSession(sessionId)
  }, [sessionId])

  const resolvePermission = useCallback(async (
    permissionId: string,
    resolution: 'allow' | 'deny',
    alwaysAllow?: boolean,
  ) => {
    if (!sessionId) return
    await api.resolvePermission(sessionId, permissionId, resolution, alwaysAllow)
  }, [sessionId])

  return {
    // State
    ...chatState,
    connected,
    session,
    sessions,

    // Actions
    loadSessions,
    loadSession,
    createSession,
    sendMessage,
    abort,
    resolvePermission,
  }
}
