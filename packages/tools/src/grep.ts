import { z } from 'zod'
import { execSync } from 'node:child_process'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const grepInput = z.object({
  pattern: z.string().describe('The regex pattern to search for'),
  include: z.string().optional().describe('File pattern to include (e.g., "*.ts")'),
})

type GrepInput = z.infer<typeof grepInput>

export const grepTool: Tool<GrepInput, string> = {
  name: 'grep',
  description: 'Search for a regex pattern in workspace files. Uses ripgrep if available, falls back to grep.',
  inputSchema: grepInput,
  isReadOnly: true,
  defaultPermission: 'allow',

  async *call(input: GrepInput, ctx: ToolContext): AsyncGenerator<Progress, string> {
    yield { type: 'progress', message: `Searching for: ${input.pattern}` }

    const safePath = ctx.workspaceRoot.replace(/"/g, '\\"')
    const safePattern = input.pattern.replace(/"/g, '\\"')
    let cmd: string

    // Try ripgrep first, fall back to grep
    try {
      execSync('which rg', { stdio: 'ignore' })
      cmd = `rg --line-number --no-heading "${safePattern}" "${safePath}" 2>/dev/null | head -100`
      if (input.include) {
        cmd = `rg --line-number --no-heading --glob "${input.include}" "${safePattern}" "${safePath}" 2>/dev/null | head -100`
      }
    } catch {
      cmd = `grep -rn "${safePattern}" "${safePath}" 2>/dev/null | head -100`
    }

    try {
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })
      return output.trim() || 'No matches found'
    } catch {
      return 'No matches found'
    }
  },
}
