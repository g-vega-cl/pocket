import { createServerFn } from '@tanstack/react-start'

const API_URL = process.env.API_URL || 'http://localhost:5173'

interface GitHubRepo {
  fullName: string
  cloneUrl: string
  description: string
  pushedAt: string
  stars: number
  language: string | null
}

export const fetchRepos = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const res = await fetch(`${API_URL}/api/github/repos`)
    if (!res.ok) return { repos: [] as GitHubRepo[] }
    return await res.json() as { repos: GitHubRepo[] }
  } catch {
    return { repos: [] as GitHubRepo[] }
  }
})
