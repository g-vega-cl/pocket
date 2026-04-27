import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Fastify from 'fastify'
import { buildApp } from '../index.js'

describe('Server API', () => {
  let tmpDir: string
  let app: ReturnType<typeof Fastify>

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `pocket-server-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    app = await buildApp({
      sessionsDir: tmpDir,
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should respond to health check', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.status).toBe('ok')
  })

  it('should create a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/user/repo', task: 'fix bug', model: 'openai/gpt-4o' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.id).toBeTruthy()
    expect(body.id).toMatch(/^sess_/)
    expect(body.status).toBe('creating')
  })

  it('should list sessions', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/user/repo', task: 'task1', model: 'openai/gpt-4o' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/user/repo2', task: 'task2', model: 'anthropic/claude' },
    })

    const res = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.sessions).toHaveLength(2)
  })

  it('should get session by ID', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/x/y', task: 'test', model: 'openai/gpt-4o' },
    })
    const { id } = JSON.parse(create.payload)

    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.id).toBe(id)
    expect(body.repoUrl).toBe('https://github.com/x/y')
  })

  it('should 404 for nonexistent session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('should verify that session events dir is created', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/x/y', task: 'test', model: 'openai/gpt-4o' },
    })
    const { id } = JSON.parse(create.payload)

    // Session directory should exist on disk
    const sessionDir = path.join(tmpDir, id)
    expect(fs.existsSync(sessionDir)).toBe(true)
  })

  it('should delete a session', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { repoUrl: 'https://github.com/x/y', task: 'test', model: 'openai/gpt-4o' },
    })
    const { id } = JSON.parse(create.payload)

    const del = await app.inject({ method: 'DELETE', url: `/api/sessions/${id}` })
    expect(del.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: `/api/sessions/${id}` })
    expect(get.statusCode).toBe(404)
  })

  it('should validate required fields for session creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { task: 'missing repo and model' },
    })
    expect(res.statusCode).toBe(400)
  })
})
