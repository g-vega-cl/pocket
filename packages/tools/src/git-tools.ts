import { z } from 'zod'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type { Tool, ToolContext, Progress } from '@pocket/core'

// ─── Utilities ────────────────────────────────────────────

export function parseRepoInfo(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
  if (!match) throw new Error('Invalid GitHub URL')
  return { owner: match[1], repo: match[2] }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
}

export function getWorkspaceDir(): string {
  const homeDir = os.homedir()
  return path.join(homeDir, '.pocket', 'workspaces')
}

export async function cloneRepo(
  repoUrl: string,
  sessionId: string,
  token?: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const workspaceDir = path.join(getWorkspaceDir(), sessionId)
  fs.mkdirSync(workspaceDir, { recursive: true })

  const repoPath = path.join(workspaceDir, 'repo')

  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true })
  }

  let authenticatedUrl = repoUrl
  if (token && repoUrl.includes('github.com')) {
    authenticatedUrl = repoUrl.replace('https://github.com', `https://${token}@github.com`)
  }

  onProgress?.('Starting clone...')

  return new Promise((resolve, reject) => {
    const git = spawn('git', ['clone', '--progress', authenticatedUrl, repoPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stderrBuffer = ''

    git.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrBuffer += chunk
      // Git sends progress to stderr; surface the last meaningful line
      const lines = chunk.split('\n').filter(l => l.trim())
      for (const line of lines) {
        if (line.includes('Receiving objects') || line.includes('Resolving deltas') || line.includes('Checking out')) {
          onProgress?.(line.trim())
        }
      }
    })

    const timeout = setTimeout(() => {
      git.kill()
      reject(new Error('Clone timed out after 5 minutes'))
    }, 300000)

    git.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        onProgress?.('Clone complete')
        resolve(repoPath)
      } else {
        reject(new Error(`git clone exited with code ${code}. stderr: ${stderrBuffer.slice(-500)}`))
      }
    })

    git.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

export async function initLocalRepo(
  sessionId: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  onProgress?.('Initializing local repo...')

  const workspaceDir = path.join(getWorkspaceDir(), sessionId)
  fs.mkdirSync(workspaceDir, { recursive: true })

  const repoPath = path.join(workspaceDir, 'repo')
  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true })
  }

  fs.mkdirSync(repoPath, { recursive: true })
  execSync(`git init`, { cwd: repoPath, stdio: 'pipe' })
  execSync(`git config user.email "pocket-agent@local"`, { cwd: repoPath, stdio: 'pipe' })
  execSync(`git config user.name "Pocket Agent"`, { cwd: repoPath, stdio: 'pipe' })

  onProgress?.('Local repo ready')
  return repoPath
}

// ─── Tools ─────────────────────────────────────────────────

const gitCreateBranchInput = z.object({
  task_description: z.string().describe('Short description of the task for the branch name'),
})

type GitCreateBranchInput = z.infer<typeof gitCreateBranchInput>

export const gitCreateBranchTool: Tool<GitCreateBranchInput, { branchName: string }> = {
  name: 'git_create_branch',
  description: 'Create a new branch for the task. Uses format: pocket/{timestamp}-{slug}',
  inputSchema: gitCreateBranchInput,
  isReadOnly: false,
  defaultPermission: 'allow',

  async *call(input: GitCreateBranchInput, ctx: ToolContext): AsyncGenerator<Progress, { branchName: string }> {
    yield { type: 'progress', message: 'Creating branch...' }

    const slug = slugify(input.task_description)
    const timestamp = Math.floor(Date.now() / 1000)
    const branchName = `pocket/${timestamp}-${slug}`

    execSync(`git -C "${ctx.workspaceRoot.replace(/"/g, '\\"')}" checkout -b ${branchName}`, {
      stdio: 'pipe',
    })

    return { branchName }
  },
}

const gitCommitInput = z.object({
  message: z.string().describe('Commit message'),
})

type GitCommitInput = z.infer<typeof gitCommitInput>

export const gitCommitTool: Tool<GitCommitInput, { success: boolean; message?: string }> = {
  name: 'git_commit',
  description: 'Stage all changes and commit with the given message',
  inputSchema: gitCommitInput,
  isReadOnly: false,
  defaultPermission: 'allow',

  async *call(input: GitCommitInput, ctx: ToolContext): AsyncGenerator<Progress, { success: boolean; message?: string }> {
    yield { type: 'progress', message: 'Committing changes...' }

    const cwd = ctx.workspaceRoot.replace(/"/g, '\\"')
    execSync(`git -C "${cwd}" add -A`, { stdio: 'pipe' })

    try {
      const safeMsg = input.message.replace(/"/g, '\\"')
      execSync(`git -C "${cwd}" commit -m "${safeMsg}"`, { stdio: 'pipe' })
      return { success: true }
    } catch (error: any) {
      const stderr = error.stderr?.toString() || error.message || ''
      if (stderr.includes('nothing to commit') || stderr.includes('no changes added')) {
        return { success: true, message: 'No changes to commit' }
      }
      throw error
    }
  },
}

const gitPushInput = z.object({
  branchName: z.string().optional().describe('Branch to push. Defaults to current branch.'),
})

type GitPushInput = z.infer<typeof gitPushInput>

export const gitPushTool: Tool<GitPushInput, { success: boolean; branch?: string }> = {
  name: 'git_push',
  description: 'Push commits to the remote repository. Protected branches (main, master, develop, pocket, staging, production) require approval.',
  inputSchema: gitPushInput,
  isReadOnly: false,
  defaultPermission: 'conditional',

  async *call(input: GitPushInput, ctx: ToolContext): AsyncGenerator<Progress, { success: boolean; branch?: string }> {
    yield { type: 'progress', message: 'Pushing to remote...' }

    const cwd = ctx.workspaceRoot

    const branch = input.branchName ||
      execSync(`git -C "${cwd.replace(/"/g, '\\"')}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()

    const protectedBranches = ['main', 'master', 'develop', 'pocket', 'staging', 'production']

    if (protectedBranches.includes(branch)) {
      throw new Error(`Cannot push to protected branch: ${branch}. Create a feature branch first.`)
    }

    // Detect detached HEAD
    if (branch === 'HEAD') {
      throw new Error('Detached HEAD state. Cannot push.')
    }

    // Set up remote with token if available
    const token = ctx.githubToken || process.env.GITHUB_TOKEN
    if (token) {
      try {
        const remoteUrl = execSync(`git -C "${cwd.replace(/"/g, '\\"')}" remote get-url origin`, { encoding: 'utf-8' }).trim()
        if (remoteUrl.includes('github.com') && !remoteUrl.includes(`://${token}@`)) {
          const authenticatedUrl = remoteUrl.replace('https://github.com', `https://${token}@github.com`)
          execSync(`git -C "${cwd.replace(/"/g, '\\"')}" remote set-url origin ${authenticatedUrl}`, { stdio: 'pipe' })
        }
      } catch {
        // no remote configured
      }
    }

    // Use spawn with timeout to avoid hanging forever on credential prompts or network stalls
    const pushResult = await new Promise<{ success: boolean; stderr: string }>((resolve, reject) => {
      const git = spawn('git', ['-C', cwd, 'push', '-u', 'origin', branch], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stderrBuffer = ''

      git.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString()
      })

      git.stdout?.on('data', (data: Buffer) => {
        // Git push sometimes sends info to stdout too
        stderrBuffer += data.toString()
      })

      const timeout = setTimeout(() => {
        git.kill()
        reject(new Error('Push timed out after 60 seconds. Check your network or authentication.'))
      }, 60000)

      git.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve({ success: true, stderr: stderrBuffer })
        } else {
          resolve({ success: false, stderr: stderrBuffer })
        }
      })

      git.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    if (!pushResult.success) {
      const errMsg = pushResult.stderr.trim() || `git push exited with an error`
      throw new Error(errMsg)
    }

    yield { type: 'progress', message: 'Push complete' }
    return { success: true, branch }
  },
}
