import { z } from 'zod'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const execAsync = promisify(exec)

const bashInput = z.object({
  command: z.string().describe('Shell command to execute'),
})

type BashInput = z.infer<typeof bashInput>

export const bashTool: Tool<BashInput, { stdout: string; stderr: string; success: boolean; exitCode?: number; timedOut?: boolean }> = {
  name: 'bash',
  description: 'Execute a shell command in the workspace. Default timeout: 5 minutes.',
  inputSchema: bashInput,
  isReadOnly: false,
  defaultPermission: 'rule-matched',

  async *call(input: BashInput, ctx: ToolContext): AsyncGenerator<Progress, { stdout: string; stderr: string; success: boolean; exitCode?: number; timedOut?: boolean }> {
    yield { type: 'progress', message: `Running: ${input.command}` }

    if (ctx.sandboxImage) {
      const { runInSandbox } = await import('./sandbox.js')
      const result = await runInSandbox(input.command, {
        image: ctx.sandboxImage,
        workspaceRoot: ctx.workspaceRoot,
        timeout: 300000,
      })
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      }
    }

    try {
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: ctx.workspaceRoot,
        timeout: 300000, // 5 minutes
        maxBuffer: 10 * 1024 * 1024, // 10MB
      })

      return {
        stdout: stdout || '',
        stderr: stderr || '',
        success: true,
        exitCode: 0,
      }
    } catch (error: any) {
      if (error.killed) {
        return {
          stdout: error.stdout || '',
          stderr: error.stderr || 'Command timed out',
          success: false,
          timedOut: true,
        }
      }
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        success: false,
        exitCode: error.code || 1,
      }
    }
  },
}
