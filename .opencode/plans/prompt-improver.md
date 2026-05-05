# Prompt Improver - Implementation Plan

## Overview

Add an interactive prompt improver that uses a separate LLM call (non-polluting) to help users refine prompts before sending to the main chat.

## 1. Extract `buildConversationFromEvents` (new file)

**File:** `packages/agent/src/conversation-builder.ts`

Extract the event-to-messages reconstruction logic from `AgentRunner.buildMessages()` into a pure, exported function:

```typescript
export function buildConversationFromEvents(
  events: Event[],
  options?: { systemPrompt?: string; nudgeText?: string },
): Message[]
```

- Takes events array and optional systemPrompt/nudgeText
- Returns `Message[]` suitable for LLM API calls
- No side effects (no watchdog, no token checks, no SSE emissions)
- Same reconstruction logic: groups events by assistant response, converts tool_call_start + tool_call_result pairs to function calls + tool messages

**Export** from `packages/agent/src/index.ts`:
```typescript
export { buildConversationFromEvents } from './conversation-builder.js'
```

**Refactor** `AgentRunner.buildMessages()` to call this function internally instead of duplicating the logic:
```typescript
private buildMessages(_userMessage: ...): Message[] {
  const events = this.eventLog.replaySync(this.sessionId)
  const nudge = this.monitor.consumeNudge()
  const messages = buildConversationFromEvents(events, {
    systemPrompt: this.systemPrompt,
    nudgeText: nudge ?? undefined,
  })
  // Token cap check remains here (emits events, agent-specific)
  // ...
  return messages
}
```

## 2. Server Endpoint

**File:** `apps/server/src/index.ts`

Add after the existing `/api/sessions/:id/messages` endpoint (~line 437):

```typescript
app.post('/api/sessions/:id/improve', async (request, reply) => {
  const { id } = request.params as { id: string }
  const { draft, conversation } = request.body as {
    draft: string
    conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  const session = sessionManager.getSession(id)
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' })
  }

  const apiKey = options.env?.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return reply.status(500).send({ error: 'OPENROUTER_API_KEY not configured' })
  }

  const provider = new OpenRouterProvider({ apiKey })

  // Get full session context from event log
  const events = eventLog.replaySync(id)
  const sessionMsgs = buildConversationFromEvents(events)

  // Filter to user/assistant text for context
  const contextLines = sessionMsgs
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
    .join('\n\n')

  const improverSystemPrompt = `You are a prompt improvement assistant working inside Pocket, a coding agent.
Your job is to help the user write better prompts for their coding session.

You have access to the full conversation history of this session, so you understand the full context.

When the user shares a draft prompt:
1. If the draft is vague or missing important details, ask up to 3 specific clarifying questions
2. If the draft is already clear, produce an improved version directly
3. When asked to finalize, output ONLY the final improved prompt text with no commentary

Be concise. Focus on making the prompt more specific, actionable, and context-aware.`

  const messages: Message[] = [
    { role: 'system', content: improverSystemPrompt },
  ]

  if (contextLines) {
    messages.push({
      role: 'system',
      content: `=== SESSION CONTEXT ===\n\n${contextLines}`,
    })
  }

  if (conversation && conversation.length > 0) {
    for (const msg of conversation) {
      messages.push({ role: msg.role, content: msg.content })
    }
  }

  messages.push({
    role: 'user',
    content: conversation && conversation.length > 0
      ? draft
      : `The user wants to improve this draft:\n\n"${draft}"\n\nHelp refine it.`,
  })

  try {
    const stream = provider.streamChat({
      model: session.model,
      messages,
    })

    let content = ''
    let actualModel: string | undefined

    let result = await stream.next()
    while (!result.done) {
      const chunk = result.value
      if (chunk.model) actualModel = chunk.model
      if (chunk.type === 'text' && chunk.text) {
        content += chunk.text
      }
      result = await stream.next()
    }

    return { content, model: actualModel || session.model }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reply.status(500).send({ error: message })
  }
})
```

Import `buildConversationFromEvents` at the top:
```typescript
import { SessionManager, EventLog, ToolRegistry, AgentRunner, ProcessManager, PermissionGate, buildConversationFromEvents } from '@pocket/agent'
```

Import `Message` type:
```typescript
import type { Event, PocketConfig, WatchdogConfig, Message } from '@pocket/core'
```

## 3. API Client

**File:** `apps/web/src/lib/api.ts`

Add new method to the `api` object:

```typescript
export interface ImprovePromptRequest {
  draft: string
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface ImprovePromptResponse {
  content: string
  model: string
}

// In the api object:
improvePrompt(id: string, input: ImprovePromptRequest): Promise<ImprovePromptResponse> {
  return request(`/sessions/${id}/improve`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
},
```

## 4. ImproverModal Component

**File:** `apps/web/src/components/ImproverModal.tsx` (new)

```tsx
import { useState, useRef, useEffect } from 'react'
import { api } from '#/lib/api.js'

interface ImproverMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ImproverModalProps {
  sessionId: string
  draft: string
  onApply: (improvedPrompt: string) => void
  onClose: () => void
}

export function ImproverModal({ sessionId, draft, onApply, onClose }: ImproverModalProps) {
  const [conversation, setConversation] = useState<ImproverMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true) // starts loading for first auto-call
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-send the first improve call on mount
  useEffect(() => {
    makeImproveCall(draft, [])
  }, [])

  async function makeImproveCall(userMessage: string, prevConversation: ImproverMessage[]) {
    setLoading(true)
    setError(null)
    try {
      const result = await api.improvePrompt(sessionId, {
        draft: userMessage,
        conversation: prevConversation,
      })
      const newMsg: ImproverMessage = { role: 'assistant', content: result.content }
      setConversation([...prevConversation, { role: 'user', content: userMessage }, newMsg])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Improve call failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSend() {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    const updatedConversation = [...conversation, { role: 'user', content: msg } as ImproverMessage]
    setConversation(updatedConversation)
    await makeImproveCall(msg, updatedConversation)
  }

  async function handleApply() {
    setLoading(true)
    try {
      const finalConversation = [...conversation, { role: 'user', content: 'Now produce the final improved prompt. Output ONLY the prompt text, no commentary.' } as ImproverMessage]
      setConversation(finalConversation)
      const result = await api.improvePrompt(sessionId, {
        draft: 'Now produce the final improved prompt. Output ONLY the prompt text, no commentary.',
        conversation: finalConversation,
      })
      onApply(result.content.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Improve Prompt</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            ✕
          </button>
        </div>

        {/* Conversation */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {conversation.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-[#4FB8B2] text-white'
                  : 'bg-purple-50 dark:bg-purple-950 text-gray-900 dark:text-gray-100 border border-purple-200 dark:border-purple-800'
              }`}>
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              </div>
            </div>
          ))}

          {loading && conversation.length === 0 && (
            <div className="flex justify-start">
              <div className="bg-purple-50 dark:bg-purple-950 rounded-lg px-3 py-2">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {loading && conversation.length > 0 && (
            <div className="flex justify-start">
              <div className="bg-purple-50 dark:bg-purple-950 rounded-lg px-3 py-2">
                <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          )}

          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Reply to the improver..."
            disabled={loading}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="px-3 py-2 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            Send
          </button>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={loading || conversation.length === 0}
            className="px-4 py-2 bg-[#4FB8B2] hover:bg-[#3da39d] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors ml-auto"
          >
            Apply Improved Prompt
          </button>
        </div>
      </div>
    </div>
  )
}
```

## 5. Integration in Chat View

**File:** `apps/web/src/routes/sessions/$id.tsx`

### Add import:
```typescript
import { ImproverModal } from '#/components/ImproverModal.js'
```

### Add state in `SessionChatView`:
```typescript
const [showImprover, setShowImprover] = useState(false)
```

### Add "✨ Improve" button between textarea and Send button (~line 326):
```tsx
{/* Between textarea and Send/Stop */}
{!isThinking && input.trim() && (
  <button
    type="button"
    onClick={() => setShowImprover(true)}
    className="px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
  >
    ✨ Improve
  </button>
)}
```

### Add modal render before closing `</div>` (after the `</form>`):
```tsx
{showImprover && (
  <ImproverModal
    sessionId={id}
    draft={input}
    onApply={(improved) => {
      setInput(improved)
      setShowImprover(false)
    }}
    onClose={() => setShowImprover(false)}
  />
)}
```

## Testing Strategy

1. First, run existing tests to ensure the refactored `buildConversationFromEvents` doesn't break `AgentRunner`:
   ```bash
   pnpm --filter @pocket/agent test
   ```

2. Verify TypeScript compilation:
   ```bash
   pnpm --filter @pocket/agent exec tsc --noEmit
   pnpm --filter @pocket/server exec tsc --noEmit
   pnpm --filter web exec tsc --noEmit
   ```
