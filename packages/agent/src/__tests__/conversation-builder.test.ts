import { describe, it, expect } from 'vitest'
import { buildConversationFromEvents } from '../conversation-builder.js'
import type { Event, Message } from '@pocket/core'

function makeEvent(type: string, payload: Record<string, unknown>, overrides: Partial<Event> = {}): Event {
  return {
    seq: overrides.seq ?? 1,
    ts: overrides.ts ?? Date.now(),
    type: type as any,
    payload: payload as any,
  }
}

describe('buildConversationFromEvents', () => {
  it('should return empty array for empty events', () => {
    const messages = buildConversationFromEvents([])
    expect(messages).toEqual([])
  })

  it('should include system prompt when provided', () => {
    const messages = buildConversationFromEvents([], {
      systemPrompt: 'You are a helper.',
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe('You are a helper.')
  })

  it('should include nudge text as user message when provided', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Original prompt' }),
    ], {
      nudgeText: '[watchdog] Please continue.',
    })
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('[watchdog] Please continue.')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('Original prompt')
  })

  it('should convert user_message events to user messages', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Hello' }),
    ])
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Hello')
  })

  it('should convert assistant_text_done to assistant message', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Hi' }),
      makeEvent('assistant_text_done', { text: 'Hello there' }),
    ])
    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('Hello there')
  })

  it('should handle null assistant text (tool call only, no content)', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Do work' }),
      makeEvent('assistant_text_done', { text: null }),
    ])
    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBeNull()
    expect(messages[1].tool_calls).toBeUndefined()
  })

  it('should attach tool_call_start events as tool_calls on assistant message', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Read file' }),
      makeEvent('assistant_text_done', { text: 'Reading...' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'read_file', args: { path: '/foo.ts' } }),
      makeEvent('tool_call_result', { toolCallId: 'call_1', toolName: 'read_file', result: 'file contents' }),
    ])
    expect(messages).toHaveLength(3)
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].tool_calls).toHaveLength(1)
    expect(messages[1].tool_calls![0].function.name).toBe('read_file')
    expect(messages[1].tool_calls![0].function.arguments).toBe('{"path":"/foo.ts"}')
  })

  it('should include tool results after assistant message', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Read file' }),
      makeEvent('assistant_text_done', { text: 'Reading...' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'read_file', args: { path: '/foo.ts' } }),
      makeEvent('tool_call_result', { toolCallId: 'call_1', toolName: 'read_file', result: 'file contents' }),
    ])
    expect(messages[2].role).toBe('tool')
    expect(messages[2].tool_call_id).toBe('call_1')
    expect(messages[2].content).toBe('{"result":"file contents"}')
  })

  it('should handle tool errors in results', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Run tool' }),
      makeEvent('assistant_text_done', { text: 'Running...' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'fail_tool', args: {} }),
      makeEvent('tool_call_result', { toolCallId: 'call_1', toolName: 'fail_tool', error: 'Something went wrong' }),
    ])
    expect(messages[2].role).toBe('tool')
    expect(messages[2].tool_call_id).toBe('call_1')
    expect(messages[2].content).toBe('{"error":"Something went wrong"}')
  })

  it('should handle tool_call_start without matching tool_call_result', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Run tool' }),
      makeEvent('assistant_text_done', { text: 'Running...' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'read_file', args: { path: '/x.ts' } }),
    ])
    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].tool_calls).toHaveLength(1)
    // No tool result message appended since there was no matching tool_call_result
  })

  it('should reconstruct multi-turn conversation correctly', () => {
    // Simulates a single user turn with multiple assistant/tool back-and-forths
    // (the typical AgentRunner pattern: one user_message, then while loop with tool calls)
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Do work' }),
      makeEvent('assistant_text_done', { text: 'Step one' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'read_file', args: { path: '/a.ts' } }),
      makeEvent('tool_call_result', { toolCallId: 'call_1', toolName: 'read_file', result: 'content A' }),
      makeEvent('assistant_text_done', { text: 'Step two' }),
      makeEvent('tool_call_start', { toolCallId: 'call_2', toolName: 'bash', args: { command: 'npm test' } }),
      makeEvent('tool_call_result', { toolCallId: 'call_2', toolName: 'bash', result: 'passed' }),
      makeEvent('assistant_text_done', { text: 'All done' }),
    ])

    expect(messages).toHaveLength(6)
    // [0] user
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Do work')
    // [1] assistant with tool
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('Step one')
    expect(messages[1].tool_calls).toHaveLength(1)
    expect(messages[1].tool_calls![0].function.name).toBe('read_file')
    // [2] tool result for call_1
    expect(messages[2].role).toBe('tool')
    expect(messages[2].tool_call_id).toBe('call_1')
    // [3] assistant with tool
    expect(messages[3].role).toBe('assistant')
    expect(messages[3].content).toBe('Step two')
    expect(messages[3].tool_calls).toHaveLength(1)
    expect(messages[3].tool_calls![0].function.name).toBe('bash')
    // [4] tool result for call_2
    expect(messages[4].role).toBe('tool')
    expect(messages[4].tool_call_id).toBe('call_2')
    // [5] assistant (no tool)
    expect(messages[5].role).toBe('assistant')
    expect(messages[5].content).toBe('All done')
    expect(messages[5].tool_calls).toBeUndefined()
  })

  it('should handle multiple tool calls in same assistant turn', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Do both' }),
      makeEvent('assistant_text_done', { text: 'Working...' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'read_file', args: { path: '/x.ts' } }),
      makeEvent('tool_call_start', { toolCallId: 'call_2', toolName: 'bash', args: { command: 'ls' } }),
      makeEvent('tool_call_result', { toolCallId: 'call_1', toolName: 'read_file', result: 'content X' }),
      makeEvent('tool_call_result', { toolCallId: 'call_2', toolName: 'bash', result: 'file1.txt' }),
    ])

    expect(messages).toHaveLength(4)
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].tool_calls).toHaveLength(2)
    expect(messages[1].tool_calls![0].function.name).toBe('read_file')
    expect(messages[1].tool_calls![1].function.name).toBe('bash')
    expect(messages[2].role).toBe('tool')
    expect(messages[2].tool_call_id).toBe('call_1')
    expect(messages[3].role).toBe('tool')
    expect(messages[3].tool_call_id).toBe('call_2')
  })

  it('should handle multi-turn with mixed tool/no-tool assistant responses', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Msg 1' }),
      makeEvent('assistant_text_done', { text: 'Thought process' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'read_file', args: { path: '/x.ts' } }),
      makeEvent('tool_call_result', { toolCallId: 'call_1', toolName: 'read_file', result: 'content' }),
      makeEvent('assistant_text_done', { text: 'Final answer' }),
    ])

    // user + assistant(with tool) + tool + assistant(no tool)
    expect(messages).toHaveLength(4)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].tool_calls).toHaveLength(1)
    expect(messages[2].role).toBe('tool')
    expect(messages[3].role).toBe('assistant')
    expect(messages[3].content).toBe('Final answer')
    expect(messages[3].tool_calls).toBeUndefined()
  })

  it('should include system prompt at the start when combined with events', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Hello' }),
      makeEvent('assistant_text_done', { text: 'Hi' }),
    ], {
      systemPrompt: 'You are Pocket.',
    })
    expect(messages).toHaveLength(3)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe('You are Pocket.')
    expect(messages[1].role).toBe('user')
    expect(messages[2].role).toBe('assistant')
  })

  it('should handle tool_call_start ordering with args from JSON', () => {
    const messages = buildConversationFromEvents([
      makeEvent('user_message', { content: 'Write and test' }),
      makeEvent('assistant_text_done', { text: 'On it.' }),
      makeEvent('tool_call_start', { toolCallId: 'call_1', toolName: 'write_file', args: { path: '/src/app.ts', content: '// code' } }),
      makeEvent('tool_call_start', { toolCallId: 'call_2', toolName: 'bash', args: { command: 'npm test' } }),
      makeEvent('tool_call_result', { toolCallId: 'call_1', toolName: 'write_file', result: 'ok' }),
      makeEvent('tool_call_result', { toolCallId: 'call_2', toolName: 'bash', result: '0 failures' }),
    ])

    expect(messages[1].tool_calls![0].function.name).toBe('write_file')
    expect(messages[1].tool_calls![0].function.arguments).toBe('{"path":"/src/app.ts","content":"// code"}')

    expect(messages[1].tool_calls![1].function.name).toBe('bash')
    expect(messages[1].tool_calls![1].function.arguments).toBe('{"command":"npm test"}')

    expect(messages[2].tool_call_id).toBe('call_1')
    expect(messages[3].tool_call_id).toBe('call_2')
  })
})
