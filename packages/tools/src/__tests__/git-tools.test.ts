import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
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

describe('gitPushTool', () => {
  let workspaceBase: string
  let repoPath: string
  let bareRepoPath: string

  beforeEach(() => {
    workspaceBase = path.join(os.tmpdir(), `pocket-git-push-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(workspaceBase, { recursive: true })

    // Create a bare repo to act as remote
    bareRepoPath = path.join(workspaceBase, 'remote.git')
    fs.mkdirSync(bareRepoPath, { recursive: true })
    execSync('git init --bare', { cwd: bareRepoPath, stdio: 'pipe' })

    // Create a local repo, add remote, make a commit on a feature branch
    repoPath = path.join(workspaceBase, 'repo')
    fs.mkdirSync(repoPath, { recursive: true })
    execSync('git init', { cwd: repoPath, stdio: 'pipe' })
    execSync('git config user.email "test@local"', { cwd: repoPath, stdio: 'pipe' })
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' })
    execSync('git remote add origin ' + bareRepoPath, { cwd: repoPath, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'hello')
    execSync('git add -A', { cwd: repoPath, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: repoPath, stdio: 'pipe' })
    execSync('git checkout -b feature/test-branch', { cwd: repoPath, stdio: 'pipe' })
  })

  afterEach(() => {
    if (fs.existsSync(workspaceBase)) {
      fs.rmSync(workspaceBase, { recursive: true, force: true })
    }
  })

  it('should push successfully to a local bare remote', async () => {
    const { gitPushTool } = await import('../git-tools.js')
    const ctx = { sessionId: 'test-sess', workspaceRoot: repoPath, resolvePath: (p: string) => path.resolve(repoPath, p) }
    const gen = gitPushTool.call({}, ctx)
    let result = await gen.next()
    while (!result.done) {
      result = await gen.next()
    }
    expect(result.value.success).toBe(true)
    expect(result.value.branch).toBe('feature/test-branch')
  })

  it('should fallback to process.env.GITHUB_TOKEN when ctx.githubToken is missing', async () => {
    const originalToken = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'ghp_fallback_token_xyz'

    // Set remote to a GitHub-style URL so token injection triggers
    execSync('git remote set-url origin https://github.com/test-user/test-repo.git', { cwd: repoPath, stdio: 'pipe' })

    const { gitPushTool } = await import('../git-tools.js')
    const ctx = { sessionId: 'test-sess', workspaceRoot: repoPath, resolvePath: (p: string) => path.resolve(repoPath, p) }
    const gen = gitPushTool.call({}, ctx)
    let result = await gen.next()
    let error: Error | null = null
    try {
      while (!result.done) {
        result = await gen.next()
      }
    } catch (err) {
      error = err as Error
    }

    // Push will fail because github.com isn't reachable, but the remote should have been updated first
    const remoteUrl = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf-8' }).trim()
    expect(remoteUrl).toContain('ghp_fallback_token_xyz@github.com')

    process.env.GITHUB_TOKEN = originalToken
  })

  it('should reject when push fails (e.g., non-fast-forward)', async () => {
    // First push from original repo so remote has the branch
    const { gitPushTool } = await import('../git-tools.js')
    const ctx = { sessionId: 'test-sess', workspaceRoot: repoPath, resolvePath: (p: string) => path.resolve(repoPath, p) }
    const gen1 = gitPushTool.call({}, ctx)
    let result1 = await gen1.next()
    while (!result1.done) {
      result1 = await gen1.next()
    }
    expect(result1.value.success).toBe(true)

    // Clone from bare repo, make a conflicting commit, push
    const otherPath = path.join(workspaceBase, 'other')
    fs.mkdirSync(otherPath, { recursive: true })
    execSync('git clone ' + bareRepoPath + ' .', { cwd: otherPath, stdio: 'pipe' })
    execSync('git config user.email "other@local"', { cwd: otherPath, stdio: 'pipe' })
    execSync('git config user.name "Other"', { cwd: otherPath, stdio: 'pipe' })
    execSync('git checkout feature/test-branch', { cwd: otherPath, stdio: 'pipe' })
    fs.writeFileSync(path.join(otherPath, 'other.txt'), 'other')
    execSync('git add -A', { cwd: otherPath, stdio: 'pipe' })
    execSync('git commit -m "other commit"', { cwd: otherPath, stdio: 'pipe' })
    execSync('git push origin feature/test-branch', { cwd: otherPath, stdio: 'pipe' })

    // Now our original repo is behind; pushing should fail
    // Make another commit in original repo so push is rejected
    fs.writeFileSync(path.join(repoPath, 'conflict.txt'), 'conflict')
    execSync('git add -A', { cwd: repoPath, stdio: 'pipe' })
    execSync('git commit -m "conflict commit"', { cwd: repoPath, stdio: 'pipe' })

    const gen2 = gitPushTool.call({}, ctx)
    let result2 = await gen2.next()
    let error: Error | null = null
    try {
      while (!result2.done) {
        result2 = await gen2.next()
      }
    } catch (err) {
      error = err as Error
    }
    expect(error).not.toBeNull()
    expect(error!.message).toContain('rejected')
  })
})
