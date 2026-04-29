export interface Event {
  seq: number
  ts: number
  type: string
  payload: Record<string, unknown>
}

export interface ToolCallState {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: unknown
  error?: string
  progress?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  timestamp: number
  toolCalls?: ToolCallState[]
}

export interface PendingPermission {
  permissionId: string
  toolName: string
  toolCallId: string
  args: Record<string, unknown>
  reason: string
  status: 'pending' | 'approved' | 'denied'
}

export interface ChatState {
  messages: ChatMessage[]
  pendingPermissions: PendingPermission[]
  status: string
  isThinking: boolean
  error: string | null
  lastSeq: number
}

function makeId(): string {
  return Math.random().toString(36).substring(2, 9)
}

function getLastAssistantMessage(state: ChatState): ChatMessage | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'assistant') {
      return state.messages[i]
    }
  }
  return undefined
}

function ensureLastAssistantMessage(state: ChatState): ChatMessage {
  const last = getLastAssistantMessage(state)
  if (last) return last

  const msg: ChatMessage = {
    id: makeId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  }
  state.messages.push(msg)
  return msg
}

export function reduceEvents(events: Event[]): ChatState {
  const state: ChatState = {
    messages: [],
    pendingPermissions: [],
    status: 'creating',
    isThinking: false,
    error: null,
    lastSeq: 0,
  }

  let currentAssistantContent = ''
  let currentReasoning = ''
  let hasStreamingAssistant = false

  for (const event of events) {
    state.lastSeq = Math.max(state.lastSeq, event.seq)

    switch (event.type) {
      case 'user_message':
        if (hasStreamingAssistant) {
          state.messages.push({
            id: makeId(),
            role: 'assistant',
            content: currentAssistantContent,
            reasoning: currentReasoning || undefined,
            timestamp: Date.now(),
          })
          currentAssistantContent = ''
          currentReasoning = ''
          hasStreamingAssistant = false
        }
        state.messages.push({
          id: makeId(),
          role: 'user',
          content: String(event.payload.content ?? ''),
          timestamp: event.ts,
        })
        break

      case 'assistant_text_delta': {
        const text = String(event.payload.text ?? '')
        const reasoning = event.payload.reasoning ? String(event.payload.reasoning) : undefined

        if (reasoning && reasoning.length > 0) {
          currentReasoning += reasoning
        }
        if (text.length > 0) {
          currentAssistantContent += text
        }
        hasStreamingAssistant = true
        break
      }

      case 'assistant_text_done':
        if (hasStreamingAssistant) {
          state.messages.push({
            id: makeId(),
            role: 'assistant',
            content: currentAssistantContent,
            reasoning: currentReasoning || undefined,
            timestamp: event.ts,
          })
          currentAssistantContent = ''
          currentReasoning = ''
          hasStreamingAssistant = false
        }
        break

      case 'tool_call_start': {
        const msg = ensureLastAssistantMessage(state)
        if (!msg.toolCalls) msg.toolCalls = []
        msg.toolCalls.push({
          toolCallId: String(event.payload.toolCallId ?? ''),
          toolName: String(event.payload.toolName ?? ''),
          args: (event.payload.args ?? {}) as Record<string, unknown>,
          status: 'running',
        })
        break
      }

      case 'tool_call_progress': {
        const tcId = String(event.payload.toolCallId ?? '')
        const msg = getLastAssistantMessage(state)
        if (msg?.toolCalls) {
          const tc = msg.toolCalls.find(t => t.toolCallId === tcId)
          if (tc) {
            tc.progress = String(event.payload.message ?? '')
          }
        }
        break
      }

      case 'tool_call_result': {
        const tcId = String(event.payload.toolCallId ?? '')
        const msg = getLastAssistantMessage(state)
        if (msg?.toolCalls) {
          const tc = msg.toolCalls.find(t => t.toolCallId === tcId)
          if (tc) {
            tc.status = event.payload.error ? 'error' : 'done'
            tc.result = event.payload.result
            tc.error = event.payload.error as string | undefined
          }
        }
        break
      }

      case 'permission_requested':
        state.pendingPermissions.push({
          permissionId: String(event.payload.permissionId ?? ''),
          toolName: String(event.payload.toolName ?? ''),
          toolCallId: String(event.payload.toolCallId ?? ''),
          args: (event.payload.args ?? {}) as Record<string, unknown>,
          reason: String(event.payload.reason ?? ''),
          status: 'pending',
        })
        break

      case 'permission_resolved': {
        const permId = String(event.payload.permissionId ?? '')
        const perm = state.pendingPermissions.find(p => p.permissionId === permId)
        if (perm) {
          perm.status = event.payload.resolution === 'allow' ? 'approved' : 'denied'
          // Remove resolved from pending list
          state.pendingPermissions = state.pendingPermissions.filter(p => p.permissionId !== permId)
        }
        break
      }

      case 'status': {
        const status = String(event.payload.status ?? '')
        state.status = status
        state.isThinking = status === 'working' || status === 'awaiting_permission'

        if (status === 'error') {
          state.error = event.payload.message ? String(event.payload.message) : 'Unknown error'
          state.isThinking = false
        }
        if (status === 'idle' || status === 'done') {
          state.error = null
          state.isThinking = false
        }
        break
      }
    }
  }

  // Flush any remaining streaming assistant content
  if (hasStreamingAssistant && (currentAssistantContent || currentReasoning)) {
    state.messages.push({
      id: makeId(),
      role: 'assistant',
      content: currentAssistantContent,
      reasoning: currentReasoning || undefined,
      timestamp: Date.now(),
    })
  }

  return state
}
