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

  return new Promise((resolve, reject) => {
    const git = spawn('git', ['clone', authenticatedUrl, repoPath], {
      stdio: 'pipe',
    })

    const timeout = setTimeout(() => {
      git.kill()
      reject(new Error('Clone timed out after 5 minutes'))
    }, 300000)

    git.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve(repoPath)
      else reject(new Error(`git clone exited with code ${code}`))
    })

    git.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

export async function initLocalRepo(sessionId: string): Promise<string> {
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

    const cwd = ctx.workspaceRoot.replace(/"/g, '\\"')

    const branch = input.branchName ||
      execSync(`git -C "${cwd}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()

    const protectedBranches = ['main', 'master', 'develop', 'pocket', 'staging', 'production']

    if (protectedBranches.includes(branch)) {
      throw new Error(`Cannot push to protected branch: ${branch}. Create a feature branch first.`)
    }

    // Detect detached HEAD
    if (branch === 'HEAD') {
      throw new Error('Detached HEAD state. Cannot push.')
    }

    // Set up remote with token if available
    if (ctx.githubToken) {
      try {
        const remoteUrl = execSync(`git -C "${cwd}" remote get-url origin`, { encoding: 'utf-8' }).trim()
        if (remoteUrl.includes('github.com') && !remoteUrl.includes(`://${ctx.githubToken}@`)) {
          const authenticatedUrl = remoteUrl.replace('https://github.com', `https://${ctx.githubToken}@github.com`)
          execSync(`git -C "${cwd}" remote set-url origin ${authenticatedUrl}`, { stdio: 'pipe' })
        }
      } catch {
        // no remote configured
      }
    }

    execSync(`git -C "${cwd}" push -u origin ${branch}`, { stdio: 'pipe' })
    return { success: true, branch }
  },
}
