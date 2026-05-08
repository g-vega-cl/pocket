import type { GitHubRepo } from '#/shared/api/client.js'
import { useRepoDropdown } from '#/features/repo/hooks/useRepoDropdown.js'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays}d ago`
  return d.toLocaleDateString()
}

interface RepoDropdownProps {
  onSelect: (repo: GitHubRepo) => void
  initialRepos?: GitHubRepo[]
  githubToken?: string
}

export function RepoDropdown({ onSelect, initialRepos, githubToken }: RepoDropdownProps) {
  const {
    search,
    updateSearch,
    select,
    isOpen,
    open,
    filteredRepos,
    repos,
    isLoading,
    selectedRepo,
    dropdownRef,
  } = useRepoDropdown(initialRepos, githubToken)

  function handleSelect(repo: GitHubRepo) {
    select(repo)
    onSelect(repo)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <input
        type="text"
        value={search || (selectedRepo ? selectedRepo.fullName : '')}
        onChange={e => updateSearch(e.target.value)}
        onFocus={() => open()}
        placeholder="Select a repo or paste a URL..."
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none"
      />
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {isLoading && repos.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-gray-400 dark:text-gray-500">
              Loading your repos...
            </div>
          ) : filteredRepos.length > 0 ? (
            filteredRepos.map(r => (
              <button
                key={r.fullName}
                type="button"
                onClick={() => handleSelect(r)}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {r.fullName}
                    </p>
                    {r.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {r.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-3 shrink-0">
                    {r.language && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">{r.language}</span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {formatDate(r.pushedAt)}
                    </span>
                    {r.stars > 0 && (
                      <span className="text-xs text-amber-500">★ {r.stars}</span>
                    )}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-2.5 text-sm text-gray-400 dark:text-gray-500">
              {repos.length > 0 ? 'No repos match your search' : 'No repos found'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
