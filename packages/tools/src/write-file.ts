import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const writeFileInput = z.object({
  path: z.string().describe('Path to the file relative to the workspace root'),
  content: z.string().describe('Full file content to write'),
})

type WriteFileInput = z.infer<typeof writeFileInput>

export const writeFileTool: Tool<WriteFileInput, { success: boolean; path: string }> = {
  name: 'write_file',
  description: 'Write or overwrite a file with the given content',
  inputSchema: writeFileInput,
  isReadOnly: false,
  defaultPermission: 'conditional',

  async *call(input: WriteFileInput, ctx: ToolContext): AsyncGenerator<Progress, { success: boolean; path: string }> {
    const resolved = ctx.resolvePath(input.path)
    yield { type: 'progress', message: `Writing ${input.path}` }

    // Ensure parent directory exists
    const dir = path.dirname(resolved)
    fs.mkdirSync(dir, { recursive: true })

    fs.writeFileSync(resolved, input.content, 'utf-8')
    return { success: true, path: input.path }
  },
}
