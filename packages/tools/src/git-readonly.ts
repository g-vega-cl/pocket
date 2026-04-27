import { z } from 'zod'
import { execSync } from 'node:child_process'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const emptyInput = z.object({})

function makeGitReadOnlyTool(
  name: string,
  description: string,
  command: string,
): Tool<Record<string, never>, string> {
  return {
    name,
    description,
    inputSchema: emptyInput,
    isReadOnly: true,
    defaultPermission: 'allow',

    async *call(_input: Record<string, never>, ctx: ToolContext): AsyncGenerator<Progress, string> {
      yield { type: 'progress', message: `Running git ${name}` }

      try {
        const output = execSync(`git -C "${ctx.workspaceRoot.replace(/"/g, '\\"')}" ${command}`, {
          encoding: 'utf-8',
          timeout: 30000,
        })
        return output.trim()
      } catch (error: any) {
        return error.stderr || error.message || 'Git command failed'
      }
    },
  }
}

export const gitStatusTool = makeGitReadOnlyTool(
  'git_status',
  'Show the working tree status (porcelain format)',
  'status --porcelain --branch',
)

export const gitLogTool = makeGitReadOnlyTool(
  'git_log',
  'Show recent commit logs (last 20 commits, one-line format)',
  'log --oneline -20',
)

export const gitDiffTool = makeGitReadOnlyTool(
  'git_diff',
  'Show changes in the working tree (unstaged + staged)',
  'diff HEAD',
)
