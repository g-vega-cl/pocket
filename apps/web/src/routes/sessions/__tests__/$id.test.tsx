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

  it('clears improver storage on apply and does not re-save improved prompt', async () => {
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

    // The improved prompt should NOT be re-saved to localStorage —
    // it lives only in React state. All improver keys are cleared.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
    expect(localStorage.getItem(CONVERSATION_KEY)).toBeNull()
  })

  it('does not persist improved prompt after page refresh', async () => {
    const SessionChatView = await getSessionChatView()

    // Simulate a fresh page load — no draft in localStorage
    render(<SessionChatView />)

    // The textarea should be empty since the improved prompt was not saved
    const textarea = screen.getByPlaceholderText('Send a message...')
    expect(textarea).toHaveValue('')
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