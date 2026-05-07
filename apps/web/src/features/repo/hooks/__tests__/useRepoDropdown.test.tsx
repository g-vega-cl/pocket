import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRepoDropdown } from '../useRepoDropdown.js'
import { api } from '#/shared/api/client.js'
import type { GitHubRepo } from '#/shared/api/client.js'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

const mockRepos: GitHubRepo[] = [
  {
    fullName: 'user/repo-a',
    cloneUrl: 'https://github.com/user/repo-a',
    description: 'Repo A',
    pushedAt: '2024-01-01T00:00:00Z',
    stars: 10,
    language: 'ts',
  },
  {
    fullName: 'user/repo-b',
    cloneUrl: 'https://github.com/user/repo-b',
    description: 'Repo B',
    pushedAt: '2024-01-02T00:00:00Z',
    stars: 5,
    language: 'js',
  },
  {
    fullName: 'acme/other',
    cloneUrl: 'https://github.com/acme/other',
    description: 'Something else',
    pushedAt: '2024-01-03T00:00:00Z',
    stars: 0,
    language: null,
  },
]

describe('useRepoDropdown', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('starts loading then exposes repos', async () => {
    vi.spyOn(api, 'fetchRepos').mockResolvedValue({ repos: mockRepos })

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.repos).toHaveLength(3))
    expect(result.current.filteredRepos).toHaveLength(3)
    expect(result.current.error).toBeNull()
  })

  it('filters repos by search text', async () => {
    vi.spyOn(api, 'fetchRepos').mockResolvedValue({ repos: mockRepos })

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.repos).toHaveLength(3))

    act(() => {
      result.current.updateSearch('repo-a')
    })

    expect(result.current.filteredRepos).toHaveLength(1)
    expect(result.current.filteredRepos[0].fullName).toBe('user/repo-a')
  })

  it('filters by description as well as fullName', async () => {
    vi.spyOn(api, 'fetchRepos').mockResolvedValue({ repos: mockRepos })

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.repos).toHaveLength(3))

    act(() => {
      result.current.updateSearch('Something')
    })

    expect(result.current.filteredRepos).toHaveLength(1)
    expect(result.current.filteredRepos[0].fullName).toBe('acme/other')
  })

  it('selects a repo and exposes it', async () => {
    vi.spyOn(api, 'fetchRepos').mockResolvedValue({ repos: mockRepos })

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.repos).toHaveLength(3))

    act(() => {
      result.current.select(mockRepos[1])
    })

    expect(result.current.search).toBe('user/repo-b')
    expect(result.current.selectedRepo).toEqual(mockRepos[1])
  })

  it('clears selectedRepo when search diverges', async () => {
    vi.spyOn(api, 'fetchRepos').mockResolvedValue({ repos: mockRepos })

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.repos).toHaveLength(3))

    act(() => {
      result.current.select(mockRepos[0])
    })
    expect(result.current.selectedRepo).toEqual(mockRepos[0])

    act(() => {
      result.current.updateSearch('free-form-url')
    })

    expect(result.current.selectedRepo).toBeNull()
  })

  it('surfaces error when fetch fails', async () => {
    vi.spyOn(api, 'fetchRepos').mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('opens dropdown when repos loaded, closes via close()', async () => {
    vi.spyOn(api, 'fetchRepos').mockResolvedValue({ repos: mockRepos })

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.repos).toHaveLength(3))

    act(() => {
      result.current.open()
    })
    expect(result.current.isOpen).toBe(true)

    act(() => {
      result.current.close()
    })

    expect(result.current.isOpen).toBe(false)
  })

  it('allows opening dropdown even when repos list is empty', async () => {
    vi.spyOn(api, 'fetchRepos').mockResolvedValue({ repos: [] })

    const { result } = renderHook(() => useRepoDropdown(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.repos).toHaveLength(0))

    act(() => {
      result.current.open()
    })
    expect(result.current.isOpen).toBe(true)
  })
})
