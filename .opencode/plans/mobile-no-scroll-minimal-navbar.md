# Plan: Mobile-First No-Scroll + Ultra-Minimal Navbar

## Files to change (in order)

### 1. NEW: `apps/web/src/state/session-context.ts`

```ts
import { createContext } from 'react'
import type { TokenUsage } from './events.js'

export interface SessionInfo {
  status: string
  tokenUsage: TokenUsage | null
  contextWindow: number
  sessionName: string
  isThinking: boolean
}

export const SessionInfoContext = createContext<SessionInfo | null>(null)
```

---

### 2. EDIT: `apps/web/src/components/ThemeToggle.tsx`

**FULL NEW CONTENT:**

```tsx
import { useEffect, useState } from 'react'

type ThemeMode = 'light' | 'dark' | 'auto'

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'auto'
  }

  const stored = window.localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }

  return 'auto'
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode

  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)

  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }

  document.documentElement.style.colorScheme = resolved
}

// Auto icon (circle-half)
function AutoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="w-4 h-4" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" />
      <path d="M8 2.5A5.5 5.5 0 0 1 8 13.5V2.5Z" fill="currentColor" />
    </svg>
  )
}

// Light icon (sun)
function LightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="w-4 h-4" strokeWidth="1.5">
      <circle cx="8" cy="8" r="3" stroke="currentColor" />
      <path d="M8 1v1.5M8 13.5V15M2.5 8H1M15 8h-1.5M4.11 4.11l-1.06-1.06M12.95 12.95l-1.06-1.06M4.11 11.89l-1.06 1.06M12.95 3.05l-1.06 1.06" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

// Dark icon (moon)
function DarkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="w-4 h-4" strokeWidth="1.5">
      <path d="M13.5 10.5A6.5 6.5 0 1 1 5.5 2.5a5.5 5.5 0 0 0 8 8Z" stroke="currentColor" />
    </svg>
  )
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    const initialMode = getInitialMode()
    setMode(initialMode)
    applyThemeMode(initialMode)
  }, [])

  useEffect(() => {
    if (mode !== 'auto') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyThemeMode('auto')

    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [mode])

  function toggleMode() {
    const nextMode: ThemeMode =
      mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light'
    setMode(nextMode)
    applyThemeMode(nextMode)
    window.localStorage.setItem('theme', nextMode)
  }

  const label =
    mode === 'auto'
      ? 'Theme: auto'
      : mode === 'dark'
        ? 'Theme: dark'
        : 'Theme: light'

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)] transition-colors"
    >
      {mode === 'auto' ? <AutoIcon /> : mode === 'dark' ? <DarkIcon /> : <LightIcon />}
    </button>
  )
}
```

---

### 3. EDIT: `apps/web/src/components/Header.tsx`

**FULL NEW CONTENT:**

```tsx
import { Link } from '@tanstack/react-router'
import { useContext } from 'react'
import ThemeToggle from './ThemeToggle'
import { SessionInfoContext } from '../state/session-context'

function StatusBadge({ status, isThinking }: { status: string; isThinking: boolean }) {
  const colors: Record<string, string> = {
    creating: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    cloning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    sandboxing: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    ready: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    working: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    idle: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    awaiting_permission: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    done: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    interrupted: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  }
  const color = colors[status] ?? colors.creating
  const label = isThinking ? `${status} …` : status
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${color} shrink-0`}>
      {label}
    </span>
  )
}

function TokenBadge({ tokenUsage, contextWindow: cw }: { tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number; contextWindow: number } | null; contextWindow: number }) {
  const total = tokenUsage?.totalTokens ?? 0
  const contextWindow = tokenUsage?.contextWindow ?? cw
  const ratio = contextWindow > 0 ? total / contextWindow : 0

  const color = ratio >= 0.9
    ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
    : ratio >= 0.75
      ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
      : ratio >= 0.5
        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'

  const barColor = ratio >= 0.9
    ? 'bg-red-500'
    : ratio >= 0.75
      ? 'bg-orange-500'
      : ratio >= 0.5
        ? 'bg-yellow-500'
        : 'bg-[#4FB8B2]'

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${color} shrink-0`}
      title={`Prompt: ${tokenUsage?.promptTokens.toLocaleString() ?? '—'} | Completion: ${tokenUsage?.completionTokens.toLocaleString() ?? '—'} | Total: ${total.toLocaleString()} / ${contextWindow.toLocaleString()}`}
    >
      <span className="w-8 h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden inline-block">
        <span className={`h-full ${barColor} rounded-full block transition-all`} style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
      </span>
      <span>{total.toLocaleString()}</span>
    </span>
  )
}

export default function Header() {
  const sessionInfo = useContext(SessionInfoContext)

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-2 backdrop-blur-lg">
      <nav className="flex items-center gap-1.5 py-1">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sea-ink)] no-underline shrink-0"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
          Pocket
        </Link>

        {sessionInfo && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0 ml-0.5">
            <StatusBadge status={sessionInfo.status} isThinking={sessionInfo.isThinking} />
            <TokenBadge tokenUsage={sessionInfo.tokenUsage} contextWindow={sessionInfo.contextWindow} />
            <span className="text-[10px] text-[var(--sea-ink-soft)] truncate shrink">
              {sessionInfo.sessionName}
            </span>
          </div>
        )}

        <div className="ml-auto shrink-0">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
```

---

### 4. EDIT: `apps/web/src/routes/sessions/$id.tsx`

**Changes from current branch:**
- Remove `StatusBadge` and `TokenBadge` functions (moved to Header)
- Remove the internal header bar div (lines 228-237)
- Wrap content in `SessionInfoContext.Provider`
- Change messages container to scrollable pattern:
  - Outer: `flex-1 overflow-y-auto`
  - Inner: `min-h-full flex flex-col justify-end px-3 py-3 space-y-3`
- Remove message height caps (area is now scrollable, so individual message caps aren't needed — the container handles overflow)
- Update height from `h-[calc(100vh-4rem)]` to `h-[calc(100vh-2rem)]`
- Reduce composer padding: `px-3 py-2`
- Remove `text-sm` from message bubbles (make text size consistent)

**FULL NEW CONTENT:**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { usePocketSession } from '#/hooks/usePocketSession.js'
import { ThinkingDrawer } from '#/components/ThinkingDrawer.js'
import { ImproverView } from '#/components/ImproverView.js'
import type { PendingPermission } from '#/state/events.js'
import { SessionInfoContext } from '#/state/session-context.js'

function formatMessageTime(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')

  if (isToday) {
    return `${hours}:${minutes}`
  }

  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}

export const Route = createFileRoute('/sessions/$id')({
  component: SessionChatView,
})

function ToolCallCard({ toolCall }: { toolCall: { toolCallId: string; toolName: string; args: Record<string, unknown>; status: string; result?: unknown; error?: string; progress?: string } }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${
          toolCall.status === 'running' ? 'bg-blue-400 animate-pulse' :
          toolCall.status === 'error' ? 'bg-red-400' :
          'bg-green-400'
        }`} />
        <span className="font-medium text-gray-700 dark:text-gray-300">{toolCall.toolName}</span>
        {toolCall.progress && (
          <span className="text-gray-500 dark:text-gray-400 truncate flex-1">{toolCall.progress}</span>
        )}
        <span className="ml-auto text-gray-400">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 text-xs space-y-1 bg-white dark:bg-gray-900">
          {Object.keys(toolCall.args).length > 0 && (
            <div>
              <span className="text-gray-500">Args: </span>
              <code className="text-gray-700 dark:text-gray-300">{JSON.stringify(toolCall.args)}</code>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div>
              <span className="text-gray-500">Result: </span>
              <pre className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-40 overflow-auto">{String(toolCall.result)}</pre>
            </div>
          )}
          {toolCall.error && (
            <div className="text-red-500">Error: {toolCall.error}</div>
          )}
        </div>
      )}
    </div>
  )
}

function PermissionPrompt({
  permission,
  onResolve,
}: {
  permission: PendingPermission
  onResolve: (permissionId: string, resolution: 'allow' | 'deny', alwaysAllow?: boolean) => void
}) {
  return (
    <div className="my-2 p-3 border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950 rounded-lg">
      <p className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-1">
        Permission Required
      </p>
      <p className="text-xs text-orange-700 dark:text-orange-300 mb-2">
        Agent wants to run <code className="font-mono bg-orange-100 dark:bg-orange-900 px-1 rounded">{permission.toolName}</code>
        {permission.reason && <span> — {permission.reason}</span>}
      </p>
      {Object.keys(permission.args).length > 0 && (
        <pre className="text-xs text-orange-600 dark:text-orange-400 mb-2 bg-orange-100 dark:bg-orange-900 p-2 rounded overflow-auto max-h-24">
          {JSON.stringify(permission.args, null, 2)}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onResolve(permission.permissionId, 'allow')}
          className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded transition-colors"
        >
          Allow
        </button>
        <button
          onClick={() => onResolve(permission.permissionId, 'deny')}
          className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => onResolve(permission.permissionId, 'allow', true)}
          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded transition-colors"
        >
          Always Allow
        </button>
      </div>
    </div>
  )
}

function SessionChatView() {
  const { id } = Route.useParams()
  const {
    messages, pendingPermissions, status, isThinking, error, tokenUsage, contextWindow,
    connected, session, sendMessage, abort, resolvePermission, loadSession,
  } = usePocketSession(id)

  const storagePrefix = `pocket:improver:${id}`
  const [input, setInput] = useState(() => localStorage.getItem(`${storagePrefix}:draft`) ?? '')
  const [showImprover, setShowImprover] = useState(() => localStorage.getItem(`${storagePrefix}:active`) === '1')

  useEffect(() => {
    loadSession(id)
  }, [id, loadSession])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setInput('')
    await sendMessage(input.trim())
  }

  function clearImproverStorage() {
    localStorage.removeItem(`${storagePrefix}:active`)
    localStorage.removeItem(`${storagePrefix}:draft`)
    localStorage.removeItem(`${storagePrefix}:conversation`)
  }

  if (showImprover) {
    return (
      <ImproverView
        sessionId={id}
        draft={input}
        onApply={(improved) => {
          setInput(improved)
          clearImproverStorage()
          setShowImprover(false)
        }}
        onBack={() => {
          clearImproverStorage()
          setShowImprover(false)
        }}
      />
    )
  }

  const sessionInfo = {
    status,
    tokenUsage,
    contextWindow,
    sessionName: session?.task || session?.repoUrl || id,
    isThinking,
  }

  return (
    <SessionInfoContext.Provider value={sessionInfo}>
      <div className="max-w-3xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
        {/* Messages — scrollable, content sticks to bottom */}
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-end px-3 py-3 space-y-3">
            {/* Workspace setup progress (shown before any user messages) */}
            {messages.filter(m => m.role === 'user').length === 0 && (status === 'creating' || status === 'cloning' || status === 'ready' || status === 'working') && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-900 dark:text-gray-100 w-full">
                  <div className="flex items-center gap-2 mb-2">
                    {status !== 'ready' && (
                      <svg className="animate-spin h-4 w-4 text-[#4FB8B2]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {status === 'ready' ? 'Workspace ready' : 'Setting up workspace'}
                    </span>
                  </div>
                  <div className="space-y-1 mb-2">
                    {status === 'creating' && <div className="text-xs text-gray-500 dark:text-gray-400">Creating session...</div>}
                    {status === 'cloning' && <div className="text-xs text-gray-500 dark:text-gray-400">Cloning repository...</div>}
                    {status === 'ready' && <div className="text-xs text-gray-500 dark:text-gray-400">Ready! Send a message to start.</div>}
                    {status === 'working' && <div className="text-xs text-gray-500 dark:text-gray-400">Analyzing repository...</div>}
                  </div>
                  {status !== 'ready' && (
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const isLatestAssistant = msg.role === 'assistant' && i === messages.length - 1
              const isFallback = msg.role === 'assistant' && msg.model && session?.model &&
                !msg.model.startsWith(session.model) && !session.model.startsWith(msg.model)
              return (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`rounded-lg px-3 py-2 text-sm w-full ${
                    msg.role === 'user'
                      ? 'bg-[#4FB8B2] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  }`}>
                    {msg.reasoning && (
                      <ThinkingDrawer reasoning={msg.reasoning} isThinking={isLatestAssistant && isThinking} />
                    )}
                    <div className="whitespace-pre-wrap break-words">{msg.content || (isThinking && i === messages.length - 1 ? 'Thinking...' : '')}</div>
                    {msg.toolCalls?.map(tc => (
                      <ToolCallCard key={tc.toolCallId} toolCall={tc} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 px-1">
                    {msg.role === 'assistant' && msg.model && (
                      <span
                        className={`text-[10px] font-mono ${isFallback ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}
                        title={isFallback ? `Requested: ${session?.model} — Fallback: ${msg.model}` : `Model: ${msg.model}`}
                      >
                        {isFallback ? '\u26A0 ' : ''}{msg.model}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {formatMessageTime(msg.timestamp)}
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Pending permissions */}
            {pendingPermissions.map(pp => (
              <PermissionPrompt key={pp.permissionId} permission={pp} onResolve={resolvePermission} />
            ))}

            {isThinking && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2 w-full">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <form onSubmit={handleSend} className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-shrink-0">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                document.querySelector('form')?.requestSubmit()
              }
            }}
            placeholder={isThinking ? 'Agent is thinking...' : 'Send a message...'}
            disabled={isThinking}
            rows={1}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none disabled:opacity-50 resize-none overflow-y-auto max-h-[80px] [field-sizing:content]"
          />
          {!isThinking && input.trim() && (
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(`${storagePrefix}:active`, '1')
                localStorage.setItem(`${storagePrefix}:draft`, input)
                setShowImprover(true)
              }}
              className="px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              ✨ Improve
            </button>
          )}
          {isThinking ? (
            <button
              type="button"
              onClick={() => abort()}
              className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-3 py-2 bg-[#4FB8B2] hover:bg-[#3da39d] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </SessionInfoContext.Provider>
  )
}
```

---

### 5. EDIT: `apps/web/src/components/ImproverView.tsx`

**FULL NEW CONTENT:**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '#/lib/api.js'

interface ImproverMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ImproverViewProps {
  sessionId: string
  draft: string
  onApply: (improvedPrompt: string) => void
  onBack: () => void
}

export function ImproverView({ sessionId, draft, onApply, onBack }: ImproverViewProps) {
  const [conversation, setConversation] = useState<ImproverMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoredRef = useRef(false)

  useEffect(() => {
    const convKey = `pocket:improver:${sessionId}:conversation`
    try {
      const saved = localStorage.getItem(convKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConversation(parsed)
          restoredRef.current = true
          setLoading(false)
          return
        }
      }
    } catch {
      // corrupted data, start fresh
    }
    makeImproveCall(draft, [])
  }, [])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  useEffect(() => {
    if (conversation.length > 0) {
      try {
        localStorage.setItem(
          `pocket:improver:${sessionId}:conversation`,
          JSON.stringify(conversation)
        )
      } catch {
        // localStorage full or unavailable
      }
    }
  }, [conversation, sessionId])

  const makeImproveCall = useCallback(async (userMessage: string, prevConversation: ImproverMessage[]) => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.improvePrompt(sessionId, {
        draft: userMessage,
        conversation: prevConversation,
      })
      setConversation([
        ...prevConversation,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: result.content },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Improve call failed')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

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
    setError(null)
    const finalMessage = 'Now produce the final improved prompt. Output ONLY the prompt text, no commentary.'
    const finalConversation: ImproverMessage[] = [
      ...conversation,
      { role: 'user', content: finalMessage },
    ]
    setConversation(finalConversation)
    try {
      const result = await api.improvePrompt(sessionId, {
        draft: finalMessage,
        conversation: finalConversation,
      })
      onApply(result.content.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize')
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      {/* Header — back button + title */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm px-1"
          aria-label="Back to chat"
        >
          ← Back
        </button>
        <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Improve Prompt
        </h2>
      </div>

      {/* Conversation — scrollable, content sticks to bottom */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col justify-end px-3 py-3 space-y-3">
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

          {loading && (
            <div className="flex justify-start">
              <div className="bg-purple-50 dark:bg-purple-950 rounded-lg px-3 py-2 border border-purple-200 dark:border-purple-800">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-shrink-0">
        <textarea
          ref={inputRef as any}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Reply to the improver..."
          disabled={loading}
          rows={1}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none disabled:opacity-50 resize-none overflow-y-auto max-h-[80px] [field-sizing:content]"
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
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-shrink-0">
        <button
          onClick={onBack}
          className="px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          disabled={loading || conversation.length === 0}
          className="px-3 py-2 bg-[#4FB8B2] hover:bg-[#3da39d] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors ml-auto"
        >
          Apply Improved Prompt
        </button>
      </div>
    </div>
  )
}
```

---

## Summary of Changes

| File | Action | Key Changes |
|------|--------|-------------|
| `state/session-context.ts` | **NEW** | React context for sharing session badges with Header |
| `components/ThemeToggle.tsx` | **EDIT** | Replaced pill button with compact SVG icon (sun/moon/auto, 16x16px) |
| `components/Header.tsx` | **EDIT** | Ultra-minimal ~32px: smaller brand pill, removed Home link, theme icon, conditional session badges via context |
| `routes/sessions/$id.tsx` | **EDIT** | Removed internal header bar (merged into Header via context), scrollable messages area with `overflow-y-auto` + `min-h-full flex-col justify-end`, updated height calc to `100vh-2rem` |
| `components/ImproverView.tsx` | **EDIT** | Same scrollable pattern, removed `scrollIntoView` auto-scroll, updated height calc |

## CSS Changes (none needed)

No CSS changes required. The `styles.css` file remains unchanged. The `.nav-link` class is no longer referenced but can stay (won't break anything).
