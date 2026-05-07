const BASE_URL = '/api'

export interface SessionListItem {
  id: string
  repoUrl: string
  task: string
  model: string
  branchName: string | null
  status: string
  createdAt: number
  lastActivity: number
}

export interface GitHubRepo {
  fullName: string
  cloneUrl: string
  description: string
  pushedAt: string
  stars: number
  language: string | null
}

export interface SessionDetail {
  id: string
  repoUrl: string
  task: string
  model: string
  branchName: string | null
  localPath: string | null
  status: string
  createdAt: number
  lastActivity: number
  nextSeq: number
  isLocal: boolean
}

export interface CreateSessionInput {
  repoUrl: string
  task: string
  model: string
  githubToken?: string
  isLocal?: boolean
}

export interface ImprovePromptRequest {
  draft: string
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface ImprovePromptResponse {
  content: string
  model: string
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  fetchRepos(token?: string): Promise<{ repos: GitHubRepo[] }> {
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    return request(`/github/repos${qs}`)
  },

  createSession(input: CreateSessionInput): Promise<{ id: string; status: string }> {
    return request('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  listSessions(): Promise<{ sessions: SessionListItem[] }> {
    return request('/sessions')
  },

  getSession(id: string): Promise<SessionDetail> {
    return request(`/sessions/${id}`)
  },

  deleteSession(id: string): Promise<{ ok: boolean }> {
    return request(`/sessions/${id}`, { method: 'DELETE' })
  },

  sendMessage(id: string, content: string): Promise<{ ok: boolean; sessionId: string }> {
    return request(`/sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  },

  abortSession(id: string): Promise<{ ok: boolean }> {
    return request(`/sessions/${id}/abort`, { method: 'POST' })
  },

  resolvePermission(
    id: string,
    permissionId: string,
    resolution: 'allow' | 'deny',
    alwaysAllow?: boolean,
  ): Promise<{ ok: boolean }> {
    return request(`/sessions/${id}/permission`, {
      method: 'POST',
      body: JSON.stringify({ permissionId, resolution, alwaysAllow }),
    })
  },

  commit(id: string): Promise<{ ok: boolean }> {
    return request(`/sessions/${id}/commit`, { method: 'POST' })
  },

  createPR(id: string): Promise<{ ok: boolean; prUrl?: string }> {
    return request(`/sessions/${id}/pr`, { method: 'POST' })
  },

  improvePrompt(id: string, input: ImprovePromptRequest): Promise<ImprovePromptResponse> {
    return request(`/sessions/${id}/improve`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
}
