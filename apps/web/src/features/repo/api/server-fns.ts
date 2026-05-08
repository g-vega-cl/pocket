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
    if (!res.ok) {
      console.error(`[fetchRepos] Fastify returned ${res.status}`)
      return { repos: [] as GitHubRepo[] }
    }
    const data = await res.json() as { repos: GitHubRepo[] }
    console.log(`[fetchRepos] SSR loaded ${data.repos.length} repos`)
    return data
  } catch (err) {
    console.error(`[fetchRepos] Fetch failed:`, err instanceof Error ? err.message : err)
    return { repos: [] as GitHubRepo[] }
  }
})
