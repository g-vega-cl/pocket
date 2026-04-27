import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatRequest, LLMChunk, ChatUsage, Message, ToolDefinition } from '@pocket/core'
import { OpenRouterProvider } from '../openrouter.js'

function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const data = lines.map(l => l + '\n\n').join('')
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data))
      controller.close()
    },
  })
}

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider

  beforeEach(() => {
    provider = new OpenRouterProvider({ apiKey: 'test-key' })
  })

  it('should implement LLMProvider interface', () => {
    expect(provider.streamChat).toBeInstanceOf(Function)
    expect(provider.countTokens).toBeInstanceOf(Function)
    expect(provider.capabilities).toBeInstanceOf(Function)
  })

  it('should return model capabilities', () => {
    const caps = provider.capabilities('openai/gpt-4o')
    expect(caps.contextWindow).toBeGreaterThan(0)
    expect(caps.supportsTools).toBe(true)
  })

  it('should return capabilities for known models with reasoning', () => {
    const caps = provider.capabilities('deepseek/deepseek-chat')
    expect(caps.supportsReasoning).toBe(true)
  })

  it('should return capabilities for known models without reasoning', () => {
    const caps = provider.capabilities('openai/gpt-4o')
    expect(caps.supportsReasoning).toBe(false)
  })

  it('should estimate tokens for messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I am doing well, thank you!' },
    ]
    const count = provider.countTokens(messages)
    expect(count).toBeGreaterThan(0)
  })

  it('should return zero tokens for empty messages', () => {
    expect(provider.countTokens([])).toBe(0)
  })

  it('should stream text chunks', async () => {
    const sseLines = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"id":"chatcmpl-2","choices":[{"delta":{"content":" world"}}]}',
      'data: {"id":"chatcmpl-3","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}',
      'data: [DONE]',
    ]

    const mockStream = createSSEStream(sseLines)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as Response)

    const req: ChatRequest = {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'Say hello' }],
    }

    const chunks: LLMChunk[] = []
    let finalUsage: ChatUsage | undefined

    const gen = provider.streamChat(req)
    while (true) {
      const result = await gen.next()
      if (result.done) {
        finalUsage = result.value as ChatUsage
        break
      }
      chunks.push(result.value)
    }

    expect(chunks.length).toBeGreaterThan(0)

    const textChunks = chunks.filter(c => c.type === 'text')
    expect(textChunks.length).toBeGreaterThan(0)

    if (finalUsage) {
      expect(finalUsage.promptTokens).toBe(10)
      expect(finalUsage.completionTokens).toBe(20)
    }
  })

  it('should accumulate tool calls', async () => {
    const sseLines = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file"}}]}}]}',
      'data: {"id":"chatcmpl-2","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\""}}]}}]}',
      'data: {"id":"chatcmpl-3","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"foo.txt\\"}"}}]}}]}',
      'data: {"id":"chatcmpl-4","choices":[{"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ]

    const mockStream = createSSEStream(sseLines)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as Response)

    const req: ChatRequest = {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'Read foo.txt' }],
      tools: [{
        type: 'function',
        function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } },
      }],
    }

    const chunks: LLMChunk[] = []
    for await (const chunk of provider.streamChat(req)) {
      chunks.push(chunk)
    }

    const toolCallChunks = chunks.filter(c => c.type === 'tool_call')
    expect(toolCallChunks.length).toBeGreaterThanOrEqual(1)
    if (toolCallChunks.length > 0) {
      expect(toolCallChunks[0].toolCall!.name).toBe('read_file')
      expect(toolCallChunks[0].toolCall!.arguments).toBe('{"path":"foo.txt"}')
    }
  })

  it('should normalize reasoning content from delta.reasoning', async () => {
    const sseLines = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning":"Let me think..."}}]}',
      'data: {"id":"chatcmpl-2","choices":[{"delta":{"content":"The answer is 42"}}]}',
      'data: {"id":"chatcmpl-3","choices":[{"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]

    const mockStream = createSSEStream(sseLines)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as Response)

    const req: ChatRequest = {
      model: 'deepseek/deepseek-chat',
      messages: [{ role: 'user', content: 'What is the answer?' }],
    }

    const chunks: LLMChunk[] = []
    for await (const chunk of provider.streamChat(req)) {
      chunks.push(chunk)
    }

    const reasoningChunks = chunks.filter(c => c.type === 'reasoning')
    expect(reasoningChunks.length).toBeGreaterThan(0)
    if (reasoningChunks.length > 0) {
      expect(reasoningChunks[0].reasoning).toContain('Let me think')
    }
  })

  it('should normalize reasoning content from delta.reasoning_content', async () => {
    const sseLines = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Hmm..."}}]}',
      'data: {"id":"chatcmpl-2","choices":[{"delta":{"content":"42"}}]}',
      'data: {"id":"chatcmpl-3","choices":[{"finish_reason":"stop"}]}',
    ]

    const mockStream = createSSEStream(sseLines)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as Response)

    const req: ChatRequest = {
      model: 'anthropic/claude-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
    }

    const chunks: LLMChunk[] = []
    for await (const chunk of provider.streamChat(req)) {
      chunks.push(chunk)
    }

    const reasoningChunks = chunks.filter(c => c.type === 'reasoning')
    expect(reasoningChunks.length).toBeGreaterThan(0)
  })

  it('should throw on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      body: null,
    } as Response)

    const req: ChatRequest = {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    }

    await expect(async () => {
      for await (const _ of provider.streamChat(req)) {
        // should not reach here
      }
    }).rejects.toThrow()
  })
})
