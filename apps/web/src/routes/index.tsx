import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '#/shared/api/client.js'
import { listSessions } from '#/features/session/api/server-fns.js'
import { RepoDropdown } from '#/features/repo/components/RepoDropdown.js'
import type { GitHubRepo } from '#/shared/api/client.js'

export const Route = createFileRoute('/')({
  loader: async () => {
    const sessionsData = await listSessions()
    return {
      sessions: sessionsData.sessions,
    }
  },
  component: HomePage,
})

function HomePage() {
  const navigate = useNavigate()
  const { sessions } = Route.useLoaderData()
  const [repoUrl, setRepoUrl] = useState('')
  const [task, setTask] = useState('')
  const [model, setModel] = useState('deepseek/deepseek-v4-flash')
  const [githubToken, setGithubToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleRepoSelect(repo: GitHubRepo) {
    setRepoUrl(repo.cloneUrl)
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

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pocket</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          A self-hosted coding agent you drive from your phone
        </p>
      </div>

      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Repository
          </label>
          <RepoDropdown onSelect={handleRepoSelect} />
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
