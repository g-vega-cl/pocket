import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { usePocketSession } from '#/hooks/usePocketSession.js'
import type { PendingPermission } from '#/state/events.js'

export const Route = createFileRoute('/sessions/$id')({
  component: SessionChatView,
})

function StatusBadge({ status, isThinking }: { status: string; isThinking: boolean }) {
  const colors: Record<string, string> = {
    creating: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    cloning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
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
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>
      {label}
    </span>
  )
}

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
    messages, pendingPermissions, status, isThinking, error,
    connected, session, sendMessage, abort, resolvePermission, loadSession,
  } = usePocketSession(id)

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadSession(id)
  }, [id, loadSession])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setInput('')
    await sendMessage(input.trim())
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 flex-shrink-0">
        <StatusBadge status={status} isThinking={isThinking} />
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} title={connected ? 'Connected' : 'Disconnected'} />
        {session && (
          <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
            {session.task || session.repoUrl}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-[#4FB8B2] text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            }`}>
              {msg.reasoning && (
                <div className="text-xs text-gray-500 dark:text-gray-400 italic mb-1 border-l-2 border-gray-300 dark:border-gray-600 pl-2">
                  {msg.reasoning}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{msg.content || (isThinking && i === messages.length - 1 ? 'Thinking...' : '')}</div>
              {msg.toolCalls?.map(tc => (
                <ToolCallCard key={tc.toolCallId} toolCall={tc} />
              ))}
            </div>
          </div>
        ))}

        {/* Pending permissions */}
        {pendingPermissions.map(pp => (
          <PermissionPrompt key={pp.permissionId} permission={pp} onResolve={resolvePermission} />
        ))}

        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-2">
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

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSend} className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={isThinking ? 'Agent is thinking...' : 'Send a message...'}
          disabled={isThinking}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none disabled:opacity-50"
        />
        {isThinking ? (
          <button
            type="button"
            onClick={() => abort()}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 bg-[#4FB8B2] hover:bg-[#3da39d] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            Send
          </button>
        )}
      </form>
    </div>
  )
}
