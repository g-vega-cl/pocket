import { z } from 'zod'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const webFetchInput = z.object({
  url: z.string().describe('The URL to fetch content from'),
})

type WebFetchInput = z.infer<typeof webFetchInput>

export const webFetchTool: Tool<WebFetchInput, string> = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the response body as text. Capped at ~100KB.',
  inputSchema: webFetchInput,
  isReadOnly: true,
  defaultPermission: 'allow',

  async *call(input: WebFetchInput, _ctx: ToolContext): AsyncGenerator<Progress, string> {
    yield { type: 'progress', message: `Fetching ${input.url}` }

    try {
      const response = await fetch(input.url, {
        headers: { 'User-Agent': 'Pocket-Agent/1.0' },
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        return `HTTP ${response.status}: ${response.statusText}`
      }

      const text = await response.text()
      // Cap at ~100KB
      if (text.length > 100000) {
        return text.substring(0, 100000) + '\n\n[Content truncated at 100KB]'
      }
      return text
    } catch (error) {
      return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
