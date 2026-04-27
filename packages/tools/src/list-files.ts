import { z } from 'zod'
import { execSync } from 'node:child_process'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const listFilesInput = z.object({
  extension: z.string().optional().describe('Filter by file extension (e.g., "ts", "js")'),
})

type ListFilesInput = z.infer<typeof listFilesInput>

export const listFilesTool: Tool<ListFilesInput, string[]> = {
  name: 'list_files',
  description: 'List files in the workspace. Optionally filter by extension.',
  inputSchema: listFilesInput,
  isReadOnly: true,
  defaultPermission: 'allow',

  async *call(input: ListFilesInput, ctx: ToolContext): AsyncGenerator<Progress, string[]> {
    yield { type: 'progress', message: 'Listing files...' }

    const safePath = ctx.workspaceRoot.replace(/"/g, '\\"')
    let cmd: string
    if (input.extension) {
      const safeExt = input.extension.replace(/"/g, '\\"')
      cmd = `find "${safePath}" -type f -name "*.${safeExt}" 2>/dev/null | head -100`
    } else {
      cmd = `find "${safePath}" -type f ! -path "*/.git/*" 2>/dev/null | head -200`
    }

    try {
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })
      const files = output.trim().split('\n').filter(Boolean)
      return files
    } catch {
      return []
    }
  },
}
