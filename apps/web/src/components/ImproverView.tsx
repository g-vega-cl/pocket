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
  const conversationEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    makeImproveCall(draft, [])
  }, [])

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, loading])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

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
    <div className="max-w-3xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
      {/* Header — back button + title */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
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

        <div ref={conversationEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-shrink-0">
        <textarea
          ref={inputRef as any}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Reply to the improver..."
          disabled={loading}
          rows={1}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none disabled:opacity-50 resize-none overflow-y-auto max-h-[200px] [field-sizing:content]"
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
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-shrink-0">
        <button
          onClick={onBack}
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
  )
}
