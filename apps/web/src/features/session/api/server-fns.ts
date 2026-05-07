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

export const listSessions = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const res = await fetch(`${API_URL}/api/sessions`)
    if (!res.ok) return { sessions: [] as SessionListItem[] }
    return await res.json() as { sessions: SessionListItem[] }
  } catch {
    return { sessions: [] as SessionListItem[] }
  }
})
