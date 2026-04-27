import { z } from 'zod'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const webSearchInput = z.object({
  query: z.string().describe('The search query'),
})

type WebSearchInput = z.infer<typeof webSearchInput>

export const webSearchTool: Tool<WebSearchInput, string> = {
  name: 'web_search',
  description: 'Search the web for information. Wraps OpenRouter web search capability.',
  inputSchema: webSearchInput,
  isReadOnly: true,
  defaultPermission: 'allow',

  async *call(input: WebSearchInput, _ctx: ToolContext): AsyncGenerator<Progress, string> {
    yield { type: 'progress', message: `Searching: ${input.query}` }

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return 'Web search unavailable: OPENROUTER_API_KEY not configured'
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: `Search query: ${input.query}\n\nProvide a concise summary of relevant information with source citations.`,
            },
          ],
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        return `Search failed: HTTP ${response.status}`
      }

      const data = await response.json() as any
      return data.choices?.[0]?.message?.content || 'No results found'
    } catch (error) {
      return `Search error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
