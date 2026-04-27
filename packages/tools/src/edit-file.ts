import { z } from 'zod'
import fs from 'node:fs'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const editFileInput = z.object({
  path: z.string().describe('Path to the file relative to the workspace root'),
  oldString: z.string().describe('The exact text to replace'),
  newString: z.string().describe('The text to replace it with'),
})

type EditFileInput = z.infer<typeof editFileInput>

export const editFileTool: Tool<EditFileInput, { success: boolean; path: string }> = {
  name: 'edit_file',
  description: 'Perform exact string replacements in a file',
  inputSchema: editFileInput,
  isReadOnly: false,
  defaultPermission: 'conditional',

  async *call(input: EditFileInput, ctx: ToolContext): AsyncGenerator<Progress, { success: boolean; path: string }> {
    const resolved = ctx.resolvePath(input.path)
    yield { type: 'progress', message: `Editing ${input.path}` }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${input.path}`)
    }

    const content = fs.readFileSync(resolved, 'utf-8')

    if (!content.includes(input.oldString)) {
      throw new Error(`oldString not found in ${input.path}`)
    }

    const count = content.split(input.oldString).length - 1
    if (count > 1) {
      throw new Error(`Found ${count} matches for oldString in ${input.path}. Provide more surrounding context to make it unique.`)
    }

    const newContent = content.replace(input.oldString, input.newString)
    fs.writeFileSync(resolved, newContent, 'utf-8')

    return { success: true, path: input.path }
  },
}
