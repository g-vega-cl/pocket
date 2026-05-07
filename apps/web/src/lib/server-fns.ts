import { createServerFn } from '@tanstack/react-start'

const API_URL = process.env.API_URL || 'http://localhost:5173'

interface SessionListItem {
  id: string
  repoUrl: string
  task: string
  model: string
  branchName: string | null
  status: string
  createdAt: number
  lastActivity: number
}

interface GitHubRepo {
  fullName: string
  cloneUrl: string
  description: string
  pushedAt: string
  stars: number
  language: string | null
}

export const fetchRepos = createServerFn({ method: 'GET' }).handler(async () => {
  const token = process.env.GITHUB_TOKEN
  if (!token) return { repos: [] as GitHubRepo[] }

  try {
    const res = await fetch('https://api.github.com/user/repos?sort=pushed&per_page=5&direction=desc', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'pocket',
      },
    })

    if (!res.ok) return { repos: [] as GitHubRepo[] }

    const data = await res.json() as Array<{
      full_name: string
      clone_url: string
      description: string | null
      pushed_at: string
      stargazers_count: number
      language: string | null
    }>

    return {
      repos: data.map(r => ({
        fullName: r.full_name,
        cloneUrl: r.clone_url,
        description: r.description ?? '',
        pushedAt: r.pushed_at,
        stars: r.stargazers_count,
        language: r.language,
      })),
    }
  } catch {
    return { repos: [] as GitHubRepo[] }
  }
})

export const listSessions = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const res = await fetch(`${API_URL}/api/sessions`)
    if (!res.ok) return { sessions: [] as SessionListItem[] }
    return await res.json() as { sessions: SessionListItem[] }
  } catch {
    return { sessions: [] as SessionListItem[] }
  }
})
