import type { LLMProvider, LLMChunk, ChatRequest, ChatUsage, Message, ModelCapabilities } from '@pocket/core'

interface OpenRouterConfig {
  apiKey: string
  baseUrl?: string
  httpReferer?: string
  title?: string
}

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'openai/gpt-4o': { contextWindow: 128000, supportsTools: true, supportsReasoning: false },
  'openai/gpt-4o-mini': { contextWindow: 128000, supportsTools: true, supportsReasoning: false },
  'anthropic/claude-sonnet': { contextWindow: 200000, supportsTools: true, supportsReasoning: false },
  'anthropic/claude-sonnet-4': { contextWindow: 200000, supportsTools: true, supportsReasoning: false },
  'deepseek/deepseek-chat': { contextWindow: 128000, supportsTools: true, supportsReasoning: true },
  'deepseek/deepseek-chat-v3-0324': { contextWindow: 128000, supportsTools: true, supportsReasoning: true },
  'xiaomi/mimo-v2-flash': { contextWindow: 128000, supportsTools: true, supportsReasoning: false },
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string
  private baseUrl: string
  private httpReferer: string
  private title: string

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl ?? OPENROUTER_BASE
    this.httpReferer = config.httpReferer ?? 'https://pocket.local'
    this.title = config.title ?? 'Pocket'
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<LLMChunk, ChatUsage> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.httpReferer,
        'X-Title': this.title,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        tools: req.tools,
        stream: true,
        max_tokens: req.maxTokens ?? 16384,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`OpenRouter error: ${response.status} - ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let currentToolCallId: string | null = null
    let currentToolName: string | null = null
    let currentToolArgs = ''
    let usage: ChatUsage | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta

            // Capture usage from any event that has it
            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens ?? 0,
                completionTokens: parsed.usage.completion_tokens ?? 0,
                totalTokens: parsed.usage.total_tokens ?? 0,
              }
            }

            if (!delta) continue

            // Normalize reasoning
            const reasoning = delta.reasoning_content ?? delta.reasoning
            if (reasoning && typeof reasoning === 'string' && reasoning.length > 0) {
              yield { type: 'reasoning', reasoning }
            }

            // Text content — OpenRouter may return content as string or array
            if (delta.content) {
              const text = typeof delta.content === 'string'
                ? delta.content
                : Array.isArray(delta.content)
                  ? delta.content.map((c: { text?: string }) => c.text ?? '').join('')
                  : ''
              if (text) {
                yield { type: 'text', text }
              }
            }

            // Tool calls — accumulate incrementally
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              const tc = delta.tool_calls[0]

              if (tc.function?.name) {
                // New tool call starting — finalize any previous
                if (currentToolName && currentToolCallId) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: currentToolCallId,
                      name: currentToolName,
                      arguments: currentToolArgs,
                    },
                  }
                }
                currentToolName = tc.function.name
                currentToolCallId = tc.id ?? null
                currentToolArgs = ''
              }

              if (tc.function?.arguments) {
                currentToolArgs += tc.function.arguments
              }
            }

          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Finalize any pending tool call after stream ends
      if (currentToolName && currentToolCallId) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: currentToolCallId,
            name: currentToolName,
            arguments: currentToolArgs,
          },
        }
      }

    } finally {
      reader.releaseLock()
    }

    return usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  }

  countTokens(messages: Message[]): number {
    let total = 0
    for (const msg of messages) {
      // Rough estimate: ~4 chars per token for English text
      total += (msg.content?.length ?? 0) / 4
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += (tc.function.arguments?.length ?? 0) / 4
        }
      }
    }
    return Math.ceil(total)
  }

  capabilities(model: string): ModelCapabilities {
    // Check for exact match first, then prefix match
    const exact = MODEL_CAPABILITIES[model]
    if (exact) return exact

    // Prefix match for variants like 'openai/gpt-4o:2024-08-06'
    for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
      if (model.startsWith(key)) return caps
    }

    return { contextWindow: 128000, supportsTools: true, supportsReasoning: false }
  }
}
