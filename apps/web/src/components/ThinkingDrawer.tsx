import { useState, useEffect, useRef } from 'react'

interface ThinkingDrawerProps {
  reasoning: string
  isThinking: boolean
}

export function ThinkingDrawer({ reasoning, isThinking }: ThinkingDrawerProps) {
  const [isOpen, setIsOpen] = useState(isThinking)
  const prevThinkingRef = useRef(isThinking)

  // Auto-close when thinking finishes, auto-open when thinking starts
  useEffect(() => {
    if (prevThinkingRef.current && !isThinking) {
      // Small delay so user can see the final thought if they're reading it
      const timer = setTimeout(() => setIsOpen(false), 300)
      return () => clearTimeout(timer)
    }
    if (isThinking) {
      setIsOpen(true)
    }
    prevThinkingRef.current = isThinking
  }, [isThinking])

  if (!reasoning) return null

  return (
    <div className="mb-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors w-full text-left"
      >
        <span className="text-[10px] font-mono">{isOpen ? '▾' : '▸'}</span>
        <span className="italic font-medium">Thinking</span>
        {isThinking && (
          <span className="inline-flex gap-0.5 ml-1">
            <span className="w-1 h-1 bg-[#4FB8B2] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 bg-[#4FB8B2] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 bg-[#4FB8B2] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        )}
      </button>
      {isOpen && (
        <div className="text-xs text-gray-500 dark:text-gray-400 italic mt-1 border-l-2 border-gray-300 dark:border-gray-600 pl-2 whitespace-pre-wrap">
          {reasoning}
        </div>
      )}
    </div>
  )
}
