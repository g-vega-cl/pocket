import { z } from 'zod'
import { execSync } from 'node:child_process'
import { Octokit } from 'octokit'
import type { Tool, ToolContext, Progress } from '@pocket/core'
import { parseRepoInfo } from './git-tools.js'

const githubCreatePRInput = z.object({
  title: z.string().describe('PR title — concise and descriptive'),
  body: z.string().describe('PR body/description in markdown'),
})

type GithubCreatePRInput = z.infer<typeof githubCreatePRInput>

export const githubCreatePRTool: Tool<GithubCreatePRInput, { success: boolean; prUrl?: string; prNumber?: number; error?: string }> = {
  name: 'github_create_pr',
  description: 'Create a GitHub pull request from the current branch to the "main" base branch.',
  inputSchema: githubCreatePRInput,
  isReadOnly: false,
  defaultPermission: 'allow',

  async *call(input: GithubCreatePRInput, ctx: ToolContext): AsyncGenerator<Progress, { success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
    yield { type: 'progress', message: 'Creating pull request...' }

    const cwd = ctx.workspaceRoot.replace(/"/g, '\\"')

    // Get current branch
    const headBranch = execSync(`git -C "${cwd}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()

    // Get remote URL
    let remoteUrl: string
    try {
      remoteUrl = execSync(`git -C "${cwd}" remote get-url origin`, { encoding: 'utf-8' }).trim()
    } catch {
      return { success: false, error: 'No remote "origin" configured' }
    }

    let owner: string, repo: string
    try {
      const info = parseRepoInfo(remoteUrl)
      owner = info.owner
      repo = info.repo
    } catch {
      return { success: false, error: 'Could not parse GitHub repo from remote URL' }
    }

    const token = ctx.githubToken || process.env.GITHUB_TOKEN
    if (!token) {
      return { success: false, error: 'No GitHub token configured. Set GITHUB_TOKEN env var or provide it in the session.' }
    }

    const octokit = new Octokit({ auth: token })

    // Ensure 'main' base branch exists locally
    try {
      execSync(`git -C "${cwd}" checkout main`, { stdio: 'ignore' })
    } catch {
      // Assume main exists on remote — fetch and track it
      try {
        execSync(`git -C "${cwd}" fetch origin main`, { stdio: 'ignore' })
        execSync(`git -C "${cwd}" checkout -b main origin/main`, { stdio: 'ignore' })
      } catch {
        // Ignore
      }
    }

    try {
      const { data: pr } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: input.title,
        body: input.body,
        head: headBranch,
        base: 'main',
      })

      return {
        success: true,
        prUrl: pr.html_url,
        prNumber: pr.number,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create PR',
      }
    }
  },
}
