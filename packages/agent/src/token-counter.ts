import type { Message } from '@pocket/core'

const CHARS_PER_TOKEN = 4

export function estimateTokens(messages: Message[]): number {
  let total = 0
  for (const msg of messages) {
    total += (msg.content?.length ?? 0) / CHARS_PER_TOKEN
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += (tc.function.name?.length ?? 0) / CHARS_PER_TOKEN
        total += (tc.function.arguments?.length ?? 0) / CHARS_PER_TOKEN
      }
    }
  }
  return Math.ceil(total)
}

export function shouldWarn(estimatedTokens: number, contextWindow: number): boolean {
  return estimatedTokens > contextWindow * 0.75
}

export function shouldBlock(estimatedTokens: number, contextWindow: number): boolean {
  return estimatedTokens > contextWindow * 0.90
}
