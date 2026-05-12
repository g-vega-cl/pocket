import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { usePocketSession } from '#/features/session/hooks/usePocketSession.js'
import { ThinkingDrawer } from '#/features/session/components/ThinkingDrawer.js'
import { ImproverView } from '#/features/session/components/ImproverView.js'
import { RatingCard } from '#/features/session/components/RatingCard.js'
import type { PendingPermission } from '#/features/session/state/events.js'
import { SessionInfoContext } from '#/features/session/state/session-context.js'

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
  ssr: false,
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
    session, sendMessage, abort, resolvePermission, loadSession,
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
    const message = input.trim()
    setInput('')
    // Clear any previously improved draft from localStorage — once
    // the message is sent, the prompt is no longer needed.
    localStorage.removeItem(`${storagePrefix}:draft`)
    await sendMessage(message)
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
          // Save improved prompt to localStorage so it survives page
          // reload or navigation before the user presses Send. Once
          // the message is sent, handleSend clears this key.
          localStorage.setItem(`${storagePrefix}:draft`, improved)
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
      <div className="max-w-3xl mx-auto h-[calc(100dvh-2.5rem)] flex flex-col">
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
                        title={isFallback ? `Requested: ${session.model} — Fallback: ${msg.model}` : `Model: ${msg.model}`}
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

            {/* Rating card — shown when session is idle/done and there are messages */}
            <RatingCard
              sessionId={id}
              visible={messages.length > 0 && !isThinking && (status === 'idle' || status === 'done' || status === 'error' || status === 'interrupted')}
            />
          </div>
        </div>

        {/* Composer */}
        <form onSubmit={handleSend} className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-shrink-0 items-stretch">
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
          <div className="flex flex-col gap-2">
            {!isThinking && input.trim() && (
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem(`${storagePrefix}:active`, '1')
                  localStorage.setItem(`${storagePrefix}:draft`, input)
                  setShowImprover(true)
                }}
                className="w-full px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                ✨ Improve
              </button>
            )}
            {isThinking ? (
              <button
                type="button"
                onClick={() => abort()}
                className="w-full px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="w-full px-3 py-2 bg-[#4FB8B2] hover:bg-[#3da39d] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </SessionInfoContext.Provider>
  )
}
