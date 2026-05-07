import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '#/shared/api/client.js'
import type { GitHubRepo } from '#/shared/api/client.js'

export function useRepoDropdown(initialData?: GitHubRepo[], githubToken?: string, onSelectRepo?: (repo: GitHubRepo) => void) {
  const hasInitialData = initialData && initialData.length > 0

  const { data, isLoading, error } = useQuery({
    queryKey: ['github', 'repos', githubToken],
    queryFn: () => api.fetchRepos(githubToken),
    staleTime: 5 * 60 * 1000,
    initialData: hasInitialData ? { repos: initialData } : undefined,
  })

  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const repos = data?.repos ?? (initialData ?? [])

  const autoSelectedRef = useRef(false)

  useEffect(() => {
    if (repos.length > 0 && !selectedRepo && !autoSelectedRef.current) {
      autoSelectedRef.current = true
      const first = repos[0]
      setSelectedRepo(first)
      onSelectRepo?.(first)
    }
  }, [repos, selectedRepo])

  useEffect(() => {
    if (!githubToken) {
      autoSelectedRef.current = false
    }
  }, [githubToken])

  const filteredRepos = useMemo(
    () =>
      repos.filter(
        (r) =>
          r.fullName.toLowerCase().includes(search.toLowerCase()) ||
          (r.description || '').toLowerCase().includes(search.toLowerCase()),
      ),
    [repos, search],
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function open() {
    setIsOpen(true)
  }

  function close() {
    setIsOpen(false)
  }

  function select(repo: GitHubRepo) {
    setSelectedRepo(repo)
    setSearch(repo.fullName)
    close()
  }

  function updateSearch(value: string) {
    setSearch(value)
    if (selectedRepo && selectedRepo.fullName !== value) {
      setSelectedRepo(null)
    }
  }

  return {
    repos,
    filteredRepos,
    isLoading,
    error,
    search,
    updateSearch,
    isOpen,
    open,
    close,
    select,
    selectedRepo,
    dropdownRef,
  }
}
