import type { Message } from '@pocket/core'
import { describe, it, expect } from 'vitest'
import { estimateTokens, shouldWarn, shouldBlock } from '../token-counter.js'

describe('token-counter', () => {
  it('should estimate tokens for messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, how are you?' },
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(50)
  })

  it('should return 0 for empty messages', () => {
    expect(estimateTokens([])).toBe(0)
  })

  it('should handle messages with tool calls', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Read file' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"foo.txt"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'file contents here' },
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should warn at 75% of context window', () => {
    const contextWindow = 128000
    expect(shouldWarn(0, contextWindow)).toBe(false)
    expect(shouldWarn(contextWindow * 0.5, contextWindow)).toBe(false)
    expect(shouldWarn(contextWindow * 0.76, contextWindow)).toBe(true)
    expect(shouldWarn(contextWindow * 0.9, contextWindow)).toBe(true)
  })

  it('should block at 90% of context window', () => {
    const contextWindow = 128000
    expect(shouldBlock(0, contextWindow)).toBe(false)
    expect(shouldBlock(contextWindow * 0.5, contextWindow)).toBe(false)
    expect(shouldBlock(contextWindow * 0.76, contextWindow)).toBe(false)
    expect(shouldBlock(contextWindow * 0.91, contextWindow)).toBe(true)
    expect(shouldBlock(contextWindow * 0.95, contextWindow)).toBe(true)
  })
})
