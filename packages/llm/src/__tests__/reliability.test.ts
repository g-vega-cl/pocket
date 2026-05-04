import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatRequest } from '@pocket/core'
import { OpenRouterProvider } from '../openrouter.js'

describe('OpenRouterProvider Reliability', () => {
  let provider: OpenRouterProvider

  beforeEach(() => {
    provider = new OpenRouterProvider({ apiKey: 'test-key' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n'))
          controller.close()
        },
      }),
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as Response)
  })

  it('should include primary model, BACKUP_MODEL, and BACKUP_MODEL_2 in the models array', async () => {
    const req: ChatRequest = {
      model: 'deepseek/deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }

    const gen = provider.streamChat(req)
    await gen.next()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"models":["deepseek/deepseek-chat","minimax/minimax-m2.5","stepfun/step-3.5-flash"]'),
      })
    )
  })

  it('should include X-OpenRouter-Cache header', async () => {
    const req: ChatRequest = {
      model: 'deepseek/deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
    }

    const gen = provider.streamChat(req)
    await gen.next()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-OpenRouter-Cache': 'true',
        }),
      })
    )
  })

  it('should add cache_control markers for anthropic models', async () => {
    const req: ChatRequest = {
      model: 'anthropic/claude-3-sonnet',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'msg 1' },
        { role: 'assistant', content: 'resp 1' },
        { role: 'user', content: 'msg 2' },
      ],
    }

    const gen = provider.streamChat(req)
    await gen.next()

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)

    // Check that at least some messages have cache_control
    const messagesWithCache = body.messages.filter((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) => c.cache_control)
    )
    expect(messagesWithCache.length).toBeGreaterThan(0)
    expect(messagesWithCache.length).toBeLessThanOrEqual(4)
  })

  it('should cap cache_control markers at 4 even with many messages', async () => {
    const req: ChatRequest = {
      model: 'anthropic/claude-3-sonnet',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'msg 1' },
        { role: 'assistant', content: 'resp 1' },
        { role: 'user', content: 'msg 2' },
        { role: 'assistant', content: 'resp 2' },
        { role: 'user', content: 'msg 3' },
        { role: 'assistant', content: 'resp 3' },
        { role: 'user', content: 'msg 4' },
      ],
    }

    const gen = provider.streamChat(req)
    await gen.next()

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)

    const messagesWithCache = body.messages.filter((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) => c.cache_control)
    )
    expect(messagesWithCache.length).toBe(4)
  })

  it('should include fallback chain even when primary matches a backup model', async () => {
    const req: ChatRequest = {
      model: 'minimax/minimax-m2.5',
      messages: [{ role: 'user', content: 'hi' }],
    }

    const gen = provider.streamChat(req)
    await gen.next()

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)

    expect(body.models).toEqual(['minimax/minimax-m2.5', 'minimax/minimax-m2.5', 'stepfun/step-3.5-flash'])
  })
})
