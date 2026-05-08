import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoDropdown } from '../RepoDropdown.js'
import type { GitHubRepo } from '#/shared/api/client.js'

const mockUseRepoDropdown = vi.fn()

vi.mock('#/features/repo/hooks/useRepoDropdown.js', () => ({
  useRepoDropdown: (...args: unknown[]) => mockUseRepoDropdown(...args),
}))

const makeRepo = (overrides?: Partial<GitHubRepo>): GitHubRepo => ({
  fullName: 'user/test-repo',
  cloneUrl: 'https://github.com/user/test-repo',
  description: 'A test repository',
  pushedAt: '2024-06-15T00:00:00Z',
  stars: 42,
  language: 'TypeScript',
  ...overrides,
})

function setupHookReturn(overrides: Record<string, unknown> = {}) {
  mockUseRepoDropdown.mockReturnValue({
    search: '',
    updateSearch: vi.fn(),
    select: vi.fn(),
    isOpen: false,
    open: vi.fn(),
    filteredRepos: [],
    repos: [],
    isLoading: false,
    selectedRepo: null,
    dropdownRef: { current: null },
    ...overrides,
  })
}

describe('RepoDropdown', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the search input with the hook search value', () => {
    setupHookReturn({ search: 'user/my-repo' })
    render(<RepoDropdown onSelect={vi.fn()} />)
    const input = screen.getByPlaceholderText('Select a repo or paste a URL...')
    expect(input).toHaveValue('user/my-repo')
  })

  it('calls updateSearch on user input', () => {
    const updateSearch = vi.fn()
    setupHookReturn({ updateSearch })
    render(<RepoDropdown onSelect={vi.fn()} />)
    const input = screen.getByPlaceholderText('Select a repo or paste a URL...')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(updateSearch).toHaveBeenCalledWith('abc')
  })

  it('calls open() on input focus', () => {
    const open = vi.fn()
    setupHookReturn({ open })
    render(<RepoDropdown onSelect={vi.fn()} />)
    const input = screen.getByPlaceholderText('Select a repo or paste a URL...')
    fireEvent.focus(input)
    expect(open).toHaveBeenCalled()
  })

  it('renders repo items when dropdown is open', async () => {
    const repo1 = makeRepo({ fullName: 'acme/frontend', description: 'UI layer' })
    const repo2 = makeRepo({ fullName: 'acme/backend', description: 'API layer' })
    setupHookReturn({
      isOpen: true,
      filteredRepos: [repo1, repo2],
    })
    render(<RepoDropdown onSelect={vi.fn()} />)

    expect(screen.getByText('acme/frontend')).toBeInTheDocument()
    expect(screen.getByText('UI layer')).toBeInTheDocument()
    expect(screen.getByText('acme/backend')).toBeInTheDocument()
    expect(screen.getByText('API layer')).toBeInTheDocument()
  })

  it('renders repo metadata (language, stars, date)', () => {
    const repo = makeRepo({
      fullName: 'org/lib',
      language: 'Rust',
      stars: 150,
      pushedAt: '2024-06-15T00:00:00Z',
    })
    setupHookReturn({ isOpen: true, filteredRepos: [repo] })
    render(<RepoDropdown onSelect={vi.fn()} />)

    expect(screen.getByText('Rust')).toBeInTheDocument()
    expect(screen.getByText('★ 150')).toBeInTheDocument()
  })

  it('calls onSelect and select when clicking a repo item', () => {
    const select = vi.fn()
    const onSelect = vi.fn()
    const repo = makeRepo({ fullName: 'org/picked' })
    setupHookReturn({ isOpen: true, filteredRepos: [repo], select })
    render(<RepoDropdown onSelect={onSelect} />)

    fireEvent.click(screen.getByText('org/picked'))
    expect(select).toHaveBeenCalledWith(repo)
    expect(onSelect).toHaveBeenCalledWith(repo)
  })

  it('shows empty message when open but no repos match', () => {
    setupHookReturn({ isOpen: true, filteredRepos: [], repos: [makeRepo()] })
    render(<RepoDropdown onSelect={vi.fn()} />)
    expect(screen.getByText('No repos match your search')).toBeInTheDocument()
  })

  it('does not render dropdown list when closed', () => {
    const repo = makeRepo()
    setupHookReturn({ isOpen: false, filteredRepos: [repo] })
    render(<RepoDropdown onSelect={vi.fn()} />)
    expect(screen.queryByText(repo.fullName)).not.toBeInTheDocument()
  })
})
