import { Link } from '@tanstack/react-router'
import { useContext } from 'react'
import ThemeToggle from '#/shared/components/ThemeToggle.js'
import { SessionInfoContext } from '#/features/session/state/session-context.js'

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
