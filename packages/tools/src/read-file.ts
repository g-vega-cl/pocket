import { z } from 'zod'
import fs from 'node:fs'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const readFileInput = z.object({
  path: z.string().describe('Path to the file relative to the workspace root'),
})

type ReadFileInput = z.infer<typeof readFileInput>

export const readFileTool: Tool<ReadFileInput, string> = {
  name: 'read_file',
  description: 'Read the contents of a file',
  inputSchema: readFileInput,
  isReadOnly: true,
  defaultPermission: 'allow',

  async *call(input: ReadFileInput, ctx: ToolContext): AsyncGenerator<Progress, string> {
    const resolved = ctx.resolvePath(input.path)
    yield { type: 'progress', message: `Reading ${input.path}` }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${input.path}`)
    }

    const stat = fs.statSync(resolved)
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${input.path}`)
    }

    return fs.readFileSync(resolved, 'utf-8')
  },
}
