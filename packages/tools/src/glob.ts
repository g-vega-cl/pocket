import { z } from 'zod'
import { execSync } from 'node:child_process'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const globInput = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")'),
})

type GlobInput = z.infer<typeof globInput>

export const globTool: Tool<GlobInput, string[]> = {
  name: 'glob',
  description: 'Find files matching a glob pattern. Uses find under the hood.',
  inputSchema: globInput,
  isReadOnly: true,
  defaultPermission: 'allow',

  async *call(input: GlobInput, ctx: ToolContext): AsyncGenerator<Progress, string[]> {
    yield { type: 'progress', message: `Finding files: ${input.pattern}` }

    const safePath = ctx.workspaceRoot.replace(/"/g, '\\"')
    // Convert glob to find-compatible pattern
    const findPattern = input.pattern
      .replace(/\*\*\/\*/g, '*/') // simplify **/* to find-compatible
      .replace(/\*/g, '*')

    const cmd = `find "${safePath}" -path "${safePath}/${findPattern}" -type f ! -path "*/.git/*" 2>/dev/null | head -100`

    try {
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })
      return output.trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  },
}
