import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { initLocalRepo, getWorkspaceDir } from '../git-tools.js'

describe('git-tools workspace setup', () => {
  let workspaceBase: string

  beforeEach(() => {
    workspaceBase = path.join(os.tmpdir(), `pocket-git-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    vi.spyOn(os, 'homedir').mockReturnValue(workspaceBase)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (fs.existsSync(workspaceBase)) {
      fs.rmSync(workspaceBase, { recursive: true, force: true })
    }
  })

  it('getWorkspaceDir should return path under ~/.pocket/workspaces', () => {
    const dir = getWorkspaceDir()
    expect(dir).toBe(path.join(workspaceBase, '.pocket', 'workspaces'))
  })

  it('initLocalRepo should create a git repo and call onProgress', async () => {
    const progress: string[] = []
    const repoPath = await initLocalRepo('test-sess-1', (msg) => progress.push(msg))

    expect(fs.existsSync(repoPath)).toBe(true)
    expect(fs.existsSync(path.join(repoPath, '.git'))).toBe(true)
    expect(progress).toContain('Initializing local repo...')
    expect(progress).toContain('Local repo ready')
  })

  it('initLocalRepo should clean up existing workspace before creating', async () => {
    const sessionId = 'test-sess-2'
    const firstPath = await initLocalRepo(sessionId)
    fs.writeFileSync(path.join(firstPath, 'stale.txt'), 'old')

    const secondPath = await initLocalRepo(sessionId)
    expect(secondPath).toBe(firstPath)
    expect(fs.existsSync(path.join(secondPath, 'stale.txt'))).toBe(false)
    expect(fs.existsSync(path.join(secondPath, '.git'))).toBe(true)
  })

  it('cloneRepo should clone a real public repo and call onProgress', async () => {
    // Use a tiny public repo to avoid network flakiness
    const { cloneRepo } = await import('../git-tools.js')
    const progress: string[] = []
    const repoPath = await cloneRepo(
      'https://github.com/octocat/Hello-World.git',
      'test-sess-3',
      undefined,
      (msg) => progress.push(msg)
    )

    expect(fs.existsSync(repoPath)).toBe(true)
    expect(fs.existsSync(path.join(repoPath, '.git'))).toBe(true)
    expect(progress).toContain('Starting clone...')
    expect(progress).toContain('Clone complete')
    // Git sends progress to stderr; we should have at least one intermediate message
    expect(progress.some(p => p.includes('Receiving objects') || p.includes('Resolving deltas'))).toBe(true)
  }, 60000)

  it('cloneRepo should overwrite an existing workspace', async () => {
    const { cloneRepo } = await import('../git-tools.js')
    const sessionId = 'test-sess-4'
    const firstPath = await cloneRepo('https://github.com/octocat/Hello-World.git', sessionId)
    fs.writeFileSync(path.join(firstPath, 'stale.txt'), 'old')

    const secondPath = await cloneRepo('https://github.com/octocat/Hello-World.git', sessionId)
    expect(secondPath).toBe(firstPath)
    expect(fs.existsSync(path.join(secondPath, 'stale.txt'))).toBe(false)
  }, 60000)
})
