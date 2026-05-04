import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Fastify from 'fastify'
import { buildApp } from '../index.js'

// Track clone calls
const cloneCalls: Array<{ repoUrl: string; sessionId: string; token?: string }> = []
const progressMessages: string[] = []

vi.mock('@pocket/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pocket/tools')>()
  return {
    ...actual,
    cloneRepo: vi.fn(async (repoUrl: string, sessionId: string, token?: string, onProgress?: (msg: string) => void) => {
      cloneCalls.push({ repoUrl, sessionId, token })
      if (onProgress) onProgress('Cloning into workspace...')
      const fakePath = path.join(os.tmpdir(), 'pocket-workspaces', sessionId, 'repo')
      fs.mkdirSync(fakePath, { recursive: true })
      fs.writeFileSync(path.join(fakePath, 'README.md'), '# fake repo')
      if (onProgress) onProgress('Clone complete')
      return fakePath
    }),
    initLocalRepo: vi.fn(async (sessionId: string, onProgress?: (msg: string) => void) => {
      if (onProgress) onProgress('Initializing local repo...')
      const fakePath = path.join(os.tmpdir(), 'pocket-workspaces', sessionId, 'repo')
      fs.mkdirSync(fakePath, { recursive: true })
      if (onProgress) onProgress('Local repo ready')
      return fakePath
    }),
  }
})

vi.mock('@pocket/llm', async () => {
  return {
    OpenRouterProvider: vi.fn().mockImplementation(() => ({
      streamChat: async function* () {
        yield { type: 'text', text: 'Hello from mock' }
      },
      countTokens: () => 10,
      capabilities: () => ({ contextWindow: 128000, supportsTools: true, supportsReasoning: false }),
    })),
  }
})

describe('Workspace initialization', () => {
  let tmpDir: string
  let app: ReturnType<typeof Fastify>

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `pocket-workspace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    cloneCalls.length = 0
    progressMessages.length = 0
    app = await buildApp({
      sessionsDir: tmpDir,
      env: { OPENROUTER_API_KEY: 'fake-key' },
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should clone repo and update session.localPath on session creation', async () => {
    // Create session — workspace setup starts immediately
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/user/repo', task: 'fix bug', model: 'openai/gpt-4o' },
    })
    expect(create.statusCode).toBe(200)
    const { id } = JSON.parse(create.payload)

    // Wait for async workspace setup to complete
    await new Promise(r => setTimeout(r, 200))

    // Verify clone was called with correct args
    expect(cloneCalls).toHaveLength(1)
    expect(cloneCalls[0].repoUrl).toBe('https://github.com/user/repo')
    expect(cloneCalls[0].sessionId).toBe(id)

    // Verify session was updated with localPath
    const get = await app.inject({ method: 'GET', url: `/api/sessions/${id}` })
    const session = JSON.parse(get.payload)
    expect(session.localPath).toBeTruthy()
    expect(session.status).not.toBe('creating')
  })

  it('should init local repo for isLocal sessions', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'local', task: 'explore', model: 'openai/gpt-4o', isLocal: true },
    })
    const { id } = JSON.parse(create.payload)

    // Wait for async workspace setup to complete
    await new Promise(r => setTimeout(r, 200))

    const get = await app.inject({ method: 'GET', url: `/api/sessions/${id}` })
    const session = JSON.parse(get.payload)
    expect(session.localPath).toBeTruthy()
    expect(cloneCalls).toHaveLength(0) // cloneRepo should NOT be called for local
  })

  it('should use existing localPath on subsequent messages without recloning', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/user/repo', task: 'fix bug', model: 'openai/gpt-4o' },
    })
    const { id } = JSON.parse(create.payload)

    // Wait for async workspace setup to complete
    await new Promise(r => setTimeout(r, 200))

    // First message
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, payload: { content: 'hello 1' } })
    await new Promise(r => setTimeout(r, 100))

    // Second message
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, payload: { content: 'hello 2' } })
    await new Promise(r => setTimeout(r, 100))

    // Should only clone once (at session creation)
    expect(cloneCalls).toHaveLength(1)
  })

  it('should persist workspace setup events to the event log', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/user/repo', task: 'fix bug', model: 'openai/gpt-4o' },
    })
    const { id } = JSON.parse(create.payload)

    // Wait for async workspace setup to complete (events are written during setup)
    await new Promise(r => setTimeout(r, 200))

    // Read events.jsonl directly
    const eventsPath = path.join(tmpDir, id, 'events.jsonl')
    expect(fs.existsSync(eventsPath)).toBe(true)
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
    const events = lines.map(l => JSON.parse(l))

    // Should have at least: tool_call_start, status (cloning), tool_call_progress ×2, status (ready)
    const toolCallStart = events.find((e: any) => e.type === 'tool_call_start')
    expect(toolCallStart).toBeTruthy()
    expect(toolCallStart.payload.toolName).toBe('clone_repo')

    const cloningStatus = events.find((e: any) => e.type === 'status' && e.payload.status === 'cloning')
    expect(cloningStatus).toBeTruthy()

    const progressEvents = events.filter((e: any) => e.type === 'tool_call_progress')
    expect(progressEvents.length).toBeGreaterThanOrEqual(2)

    const readyStatus = events.find((e: any) => e.type === 'status' && e.payload.status === 'ready')
    expect(readyStatus).toBeTruthy()
  })
})
