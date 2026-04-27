import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionManager } from '../session-manager.js'
import { EventLog } from '../event-log.js'

describe('SessionManager', () => {
  let tmpDir: string
  let eventLog: EventLog
  let manager: SessionManager

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pocket-sm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    eventLog = new EventLog(tmpDir)
    manager = new SessionManager(tmpDir, eventLog)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should create a session and return SessionMeta', () => {
    const session = manager.createSession({
      repoUrl: 'https://github.com/user/repo',
      task: 'fix bug',
      model: 'openai/gpt-4o',
      isLocal: false,
    })

    expect(session.id).toBeTruthy()
    expect(session.id).toMatch(/^sess_/)
    expect(session.repoUrl).toBe('https://github.com/user/repo')
    expect(session.task).toBe('fix bug')
    expect(session.status).toBe('creating')
    expect(session.nextSeq).toBe(1)
    expect(session.branchName).toBeNull()
  })

  it('should persist session meta to disk', () => {
    const session = manager.createSession({
      repoUrl: 'https://github.com/user/repo',
      task: 'add feature',
      model: 'anthropic/claude-sonnet',
      isLocal: true,
    })

    const metaPath = path.join(tmpDir, session.id, 'meta.json')
    expect(fs.existsSync(metaPath)).toBe(true)

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    expect(meta.id).toBe(session.id)
    expect(meta.repoUrl).toBe('https://github.com/user/repo')
    expect(meta.status).toBe('creating')
  })

  it('should get a session by ID', () => {
    const created = manager.createSession({
      repoUrl: 'https://github.com/user/repo',
      task: 'test',
      model: 'openai/gpt-4o',
    })

    const fetched = manager.getSession(created.id)
    expect(fetched).toBeTruthy()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.task).toBe('test')
  })

  it('should return null for nonexistent session', () => {
    expect(manager.getSession('nonexistent')).toBeNull()
  })

  it('should list all sessions sorted by createdAt desc', async () => {
    const s1 = manager.createSession({
      repoUrl: 'https://github.com/a/b',
      task: 'first',
      model: 'openai/gpt-4o',
    })
    // Small delay so timestamps differ
    await new Promise(resolve => setTimeout(resolve, 5))
    const s2 = manager.createSession({
      repoUrl: 'https://github.com/c/d',
      task: 'second',
      model: 'openai/gpt-4o',
    })

    const list = manager.listSessions()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(s2.id) // newest first
    expect(list[1].id).toBe(s1.id)
  })

  it('should update session status and lastActivity', () => {
    const session = manager.createSession({
      repoUrl: 'https://github.com/x/y',
      task: 'test',
      model: 'openai/gpt-4o',
    })

    const beforeUpdate = session.lastActivity
    const updated = manager.updateSession(session.id, { status: 'cloning', branchName: 'pocket/123-test' })

    expect(updated).toBeTruthy()
    expect(updated!.status).toBe('cloning')
    expect(updated!.branchName).toBe('pocket/123-test')
    expect(updated!.lastActivity).toBeGreaterThanOrEqual(beforeUpdate)

    // Verify disk persistence
    const metaPath = path.join(tmpDir, session.id, 'meta.json')
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    expect(meta.status).toBe('cloning')
    expect(meta.branchName).toBe('pocket/123-test')
  })

  it('should update nextSeq on the session', () => {
    const session = manager.createSession({
      repoUrl: 'https://github.com/x/y',
      task: 'test',
      model: 'openai/gpt-4o',
    })

    manager.updateSession(session.id, { nextSeq: 5 })
    const fetched = manager.getSession(session.id)
    expect(fetched!.nextSeq).toBe(5)
  })

  it('should delete a session', () => {
    const session = manager.createSession({
      repoUrl: 'https://github.com/a/b',
      task: 'delete me',
      model: 'openai/gpt-4o',
    })

    const result = manager.deleteSession(session.id)
    expect(result).toBe(true)
    expect(manager.getSession(session.id)).toBeNull()

    // Meta file should be removed
    const metaPath = path.join(tmpDir, session.id, 'meta.json')
    expect(fs.existsSync(metaPath)).toBe(false)
  })

  it('should return false when deleting nonexistent session', () => {
    expect(manager.deleteSession('nonexistent')).toBe(false)
  })

  it('should scan sessions on startup and mark working as interrupted', () => {
    // Create sessions with first manager
    const session1 = manager.createSession({
      repoUrl: 'https://github.com/a/b',
      task: 'task1',
      model: 'openai/gpt-4o',
    })
    manager.updateSession(session1.id, { status: 'working' })

    // Create a new manager that scans the same directory
    // Crash recovery: 'working' sessions should be marked 'interrupted'
    const manager2 = new SessionManager(tmpDir, eventLog)
    const list = manager2.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(session1.id)
    expect(list[0].status).toBe('interrupted')
  })

  it('should strip githubToken from persisted meta', () => {
    const session = manager.createSession({
      repoUrl: 'https://github.com/x/y',
      task: 'test',
      model: 'openai/gpt-4o',
      githubToken: 'ghp_secret123',
    })

    const metaPath = path.join(tmpDir, session.id, 'meta.json')
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    expect(meta.githubToken).toBeUndefined()
  })

  it('should keep githubToken in memory', () => {
    const session = manager.createSession({
      repoUrl: 'https://github.com/x/y',
      task: 'test',
      model: 'openai/gpt-4o',
      githubToken: 'ghp_secret456',
    })

    const fetched = manager.getSession(session.id)
    expect(fetched!.githubToken).toBe('ghp_secret456')
  })
})
