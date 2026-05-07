import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { api } from '#/lib/api.js'
import { fetchRepos, listSessions } from '#/lib/server-fns.js'
import type { GitHubRepo } from '#/lib/api.js'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [sessionsData, reposData] = await Promise.all([
      listSessions(),
      fetchRepos(),
    ])
    return {
      sessions: sessionsData.sessions,
      repos: reposData.repos,
    }
  },
  component: HomePage,
})

function LoadingSkeleton() {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
      <div className="space-y-4">
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      </div>
      <div className="space-y-2">
        <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      </div>
    </div>
  )
}

function HomePage() {
  const navigate = useNavigate()
  const loaderData = Route.useLoaderData()

  // If loaderData is still pending (during SSR fetch on client navigation), show skeleton
  if (!loaderData) {
    return <LoadingSkeleton />
  }

  const { sessions, repos } = loaderData
  const [repoUrl, setRepoUrl] = useState('')
  const [task, setTask] = useState('')
  const [model, setModel] = useState('deepseek/deepseek-v4-flash')
  const [githubToken, setGithubToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Repo dropdown state
  const [repoSearch, setRepoSearch] = useState('')
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setRepoDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredRepos = repos.filter(r =>
    r.fullName.toLowerCase().includes(repoSearch.toLowerCase()) ||
    r.description.toLowerCase().includes(repoSearch.toLowerCase())
  )

  function handleRepoSelect(repo: GitHubRepo) {
    setRepoUrl(repo.cloneUrl)
    setRepoSearch(repo.fullName)
    setRepoDropdownOpen(false)
  }

  function handleRepoUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRepoUrl(e.target.value)
    setRepoSearch(e.target.value)
  }

  function handleRepoUrlFocus() {
    if (repos.length > 0) {
      setRepoDropdownOpen(true)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!repoUrl || !task) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.createSession({ repoUrl, task, model, githubToken: githubToken || undefined })
      navigate({ to: '/sessions/$id', params: { id: result.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setLoading(false)
    }
  }

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

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pocket</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          A self-hosted coding agent you drive from your phone
        </p>
      </div>

      <form onSubmit={handleCreate} className="space-y-4">
        <div className="relative" ref={repoDropdownRef}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Repository
          </label>
          <input
            type="text"
            value={repoSearch || repoUrl}
            onChange={handleRepoUrlChange}
            onFocus={handleRepoUrlFocus}
            placeholder="Select a repo or paste a URL..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none"
          />
          {repoDropdownOpen && filteredRepos.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
              {filteredRepos.map(r => (
                <button
                  key={r.fullName}
                  type="button"
                  onClick={() => handleRepoSelect(r)}
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
              ))}
            </div>
          )}
          {repoDropdownOpen && filteredRepos.length === 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              No repos match your search
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Task description
          </label>
          <textarea
            value={task}
            onChange={e => setTask(e.target.value)}
            placeholder="e.g., Fix the NPE in user_service.py"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Model
            </label>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              GitHub Token (optional)
            </label>
            <input
              type="password"
              value={githubToken}
              onChange={e => setGithubToken(e.target.value)}
              placeholder="ghp_..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-[#4FB8B2] focus:border-transparent outline-none"
            />
          </div>
        </div>

        {error && (
          <div className="text-red-500 text-sm">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !repoUrl || !task}
          className="w-full py-2 px-4 bg-[#4FB8B2] hover:bg-[#3da39d] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Creating...' : 'New Session'}
        </button>
      </form>

      {sessions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Recent Sessions
          </h2>
          <div className="space-y-2">
            {sessions.map(s => (
              <button
                key={s.id}
                onClick={() => navigate({ to: '/sessions/$id', params: { id: s.id } })}
                className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {s.task || s.repoUrl}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {s.repoUrl}
                    </p>
                  </div>
                  <span className={`ml-3 text-xs px-2 py-0.5 rounded-full ${
                    s.status === 'working' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                    s.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                    s.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  }`}>
                    {s.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
