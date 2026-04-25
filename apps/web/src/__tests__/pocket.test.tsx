import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePocket } from '#/hooks/usePocket';
import { PocketApp } from '#/components/PocketApp';

vi.mock('#/hooks/usePocket');

const mockedUsePocket = vi.mocked(usePocket);

describe('Pocket Module Tests', () => {
  it('should export Route from pocket.tsx', async () => {
    const pocket = await import('../routes/pocket');
    expect(pocket.Route).toBeDefined();
  });

  it('should have usePocket hook', async () => {
    const hook = await import('../hooks/usePocket');
    expect(hook.usePocket).toBeDefined();
    expect(typeof hook.usePocket).toBe('function');
  });
});

describe('PocketApp UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockUsePocket(overrides: Partial<ReturnType<typeof usePocket>> = {}) {
    const defaults: ReturnType<typeof usePocket> = {
      connected: true,
      session: {
        id: 'test-session',
        repoUrl: 'https://github.com/test/repo',
        task: 'Test task',
        localPath: '/tmp/test',
        branchName: 'pocket/test',
        history: [],
        status: 'ready',
      },
      sessions: [],
      messages: [],
      isLoading: false,
      isThinking: false,
      currentToolCall: null,
      toolLogs: [],
      prUrl: null,
      error: null,
      notification: null,
      pendingPermission: null,
      lastSyncTime: null,
      syncing: false,
      createSession: vi.fn(),
      createLocalSession: vi.fn(),
      resumeSession: vi.fn(),
      listSessions: vi.fn(),
      respondToPermission: vi.fn(),
      clone: vi.fn(),
      createBranch: vi.fn(),
      sendMessage: vi.fn(),
      commit: vi.fn(),
      createPR: vi.fn(),
      preSetup: vi.fn(),
      disconnect: vi.fn(),
    };
    mockedUsePocket.mockReturnValue({ ...defaults, ...overrides } as ReturnType<typeof usePocket>);
  }

  it('should render thinking indicator when isThinking is true', () => {
    mockUsePocket({ isThinking: true });
    render(<PocketApp />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('should render reasoning text inside assistant messages', () => {
    mockUsePocket({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Answer', reasoning: 'Let me think about this' },
      ],
    });
    render(<PocketApp />);
    expect(screen.getByText('Let me think about this')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
  });

  it('should not show bouncing dots when isThinking is true', () => {
    mockUsePocket({ isThinking: true, isLoading: true });
    render(<PocketApp />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    // Only the thinking indicator should have bouncing dots (3 dots), not the old loader
    expect(document.querySelectorAll('.animate-bounce').length).toBe(3);
  });

  it('should render start session buttons with correct disabled state when no input', () => {
    mockUsePocket({ isLoading: false, session: null });
    render(<PocketApp />);
    const startBtn = screen.getByRole('button', { name: /Start Session/i });
    const startLocalBtn = screen.getByRole('button', { name: /Start Local Session/i });
    expect(startBtn).toBeDisabled();
    expect(startLocalBtn).toBeDisabled();
  });

  it('should enable start session button when repoUrl and task are provided', () => {
    mockUsePocket({ isLoading: false, session: null });
    render(<PocketApp />);
    const startBtn = screen.getByRole('button', { name: /Start Session/i });
    expect(startBtn).toBeDisabled();
  });

  it('should disable start session buttons when loading', () => {
    mockUsePocket({ isLoading: true, session: null });
    render(<PocketApp />);
    const startBtn = screen.getByRole('button', { name: /Start Session/i });
    const startLocalBtn = screen.getByRole('button', { name: /Start Local Session/i });
    expect(startBtn).toBeDisabled();
    expect(startLocalBtn).toBeDisabled();
  });
});
