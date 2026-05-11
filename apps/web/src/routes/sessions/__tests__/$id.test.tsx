import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { JSX } from 'react'

// Mock @tanstack/react-router — createFileRoute returns a configurator function
// that returns the route object with useParams
const mockUseParams = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: mockUseParams,
  }),
}))

// Mock ImproverView to render a simple UI that calls onApply/onBack
const mockImproverView = vi.fn()
vi.mock('#/features/session/components/ImproverView.js', () => ({
  ImproverView: (props: {
    onApply: (improved: string) => void
    onBack: () => void
    sessionId: string
    draft: string
  }) => {
    mockImproverView(props)
    return (
      <div data-testid="improver-view">
        <button
          data-testid="apply-improved"
          onClick={() => props.onApply('improved prompt text')}
        >
          Apply Improved Prompt
        </button>
        <button data-testid="back" onClick={() => props.onBack()}>
          Back
        </button>
      </div>
    )
  },
}))

// Mock usePocketSession
vi.mock('#/features/session/hooks/usePocketSession.js', () => ({
  usePocketSession: () => ({
    messages: [],
    pendingPermissions: [],
    status: 'ready',
    isThinking: false,
    error: null,
    tokenUsage: null,
    contextWindow: 128000,
    session: null,
    sendMessage: vi.fn(),
    abort: vi.fn(),
    resolvePermission: vi.fn(),
    loadSession: vi.fn(),
  }),
}))

// Mock ThinkingDrawer and SessionInfoContext
vi.mock('#/features/session/components/ThinkingDrawer.js', () => ({
  ThinkingDrawer: () => null,
}))

vi.mock('#/features/session/state/session-context.js', () => ({
  SessionInfoContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}))

async function getSessionChatView() {
  const mod = await import('../$id.tsx')
  return mod.Route.component as () => JSX.Element
}

describe('SessionChatView — localStorage persistence on Apply', () => {
  const SESSION_ID = 'test-session-123'
  const STORAGE_PREFIX = `pocket:improver:${SESSION_ID}`
  const DRAFT_KEY = `${STORAGE_PREFIX}:draft`
  const ACTIVE_KEY = `${STORAGE_PREFIX}:active`
  const CONVERSATION_KEY = `${STORAGE_PREFIX}:conversation`

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    mockUseParams.mockReturnValue({ id: SESSION_ID })
  })

  it('saves improved prompt to localStorage before clearing improver storage', async () => {
    const SessionChatView = await getSessionChatView()

    // Set up localStorage so ImproverView is shown with a draft
    localStorage.setItem(DRAFT_KEY, 'my original prompt')
    localStorage.setItem(ACTIVE_KEY, '1')

    render(<SessionChatView />)

    // Verify ImproverView rendered with the draft
    expect(screen.getByTestId('improver-view')).toBeInTheDocument()
    expect(mockImproverView).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        draft: 'my original prompt',
      }),
    )

    // Click Apply
    fireEvent.click(screen.getByTestId('apply-improved'))

    // The improved prompt should be saved to localStorage BEFORE clearImproverStorage runs
    expect(localStorage.getItem(DRAFT_KEY)).toBe('improved prompt text')

    // clearImproverStorage removes active and conversation keys
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
    expect(localStorage.getItem(CONVERSATION_KEY)).toBeNull()
  })

  it('persists improved prompt so it survives page refresh', async () => {
    const SessionChatView = await getSessionChatView()

    // Simulate what localStorage looks like after Apply ran (with the fix)
    localStorage.setItem(DRAFT_KEY, 'improved prompt text')

    // Active flag is false/gone, so the main chat view renders
    render(<SessionChatView />)

    // The textarea should be pre-filled with the improved prompt from localStorage
    const textarea = screen.getByPlaceholderText('Send a message...')
    expect(textarea).toHaveValue('improved prompt text')
  })

  it('clears all improver storage on back', async () => {
    const SessionChatView = await getSessionChatView()

    // Setup: user is in the improver with a draft and conversation
    localStorage.setItem(DRAFT_KEY, 'draft text')
    localStorage.setItem(ACTIVE_KEY, '1')
    localStorage.setItem(
      CONVERSATION_KEY,
      JSON.stringify([{ role: 'assistant', content: 'hello' }]),
    )

    render(<SessionChatView />)

    // Click Back
    fireEvent.click(screen.getByTestId('back'))

    // All improver storage should be cleared
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
    expect(localStorage.getItem(CONVERSATION_KEY)).toBeNull()
  })
})