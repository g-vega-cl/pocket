import { describe, it, expect } from 'vitest'
import { reduceEvents } from '../events.js'
import type { Event } from '../events.js'

function ev(overrides: Partial<Event> & { type: Event['type'] }): Event {
  const { type, seq, ts, payload } = overrides
  return {
    seq: seq ?? 1,
    ts: ts ?? Date.now(),
    type,
    payload: (payload ?? {}) as any,
  }
}

describe('reduceEvents', () => {
  it('should initialize with empty state', () => {
    const state = reduceEvents([])
    expect(state.messages).toEqual([])
    expect(state.status).toBe('creating')
    expect(state.isThinking).toBe(false)
    expect(state.toolCalls).toEqual([])
    expect(state.pendingPermissions).toEqual([])
  })

  it('should process user_message event', () => {
    const state = reduceEvents([
      ev({ type: 'user_message', seq: 1, payload: { content: 'Hello' } }),
    ])
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('user')
    expect(state.messages[0].content).toBe('Hello')
  })

  it('should process assistant_text_delta events into a single message', () => {
    const state = reduceEvents([
      ev({ type: 'user_message', seq: 1, payload: { content: 'Hi' } }),
      ev({ type: 'assistant_text_delta', seq: 2, payload: { text: 'Hello' } }),
      ev({ type: 'assistant_text_delta', seq: 3, payload: { text: ' world' } }),
      ev({ type: 'assistant_text_done', seq: 4, payload: { text: 'Hello world' } }),
    ])
    expect(state.messages).toHaveLength(2)
    expect(state.messages[1].role).toBe('assistant')
    expect(state.messages[1].content).toBe('Hello world')
  })

  it('should track thinking state during working status', () => {
    const state = reduceEvents([
      ev({ type: 'status', seq: 1, payload: { status: 'working' } }),
    ])
    expect(state.isThinking).toBe(true)
    expect(state.status).toBe('working')
  })

  it('should stop thinking on idle status', () => {
    const state = reduceEvents([
      ev({ type: 'status', seq: 1, payload: { status: 'working' } }),
      ev({ type: 'status', seq: 2, payload: { status: 'idle' } }),
    ])
    expect(state.isThinking).toBe(false)
    expect(state.status).toBe('idle')
  })

  it('should process tool call events', () => {
    const state = reduceEvents([
      ev({ type: 'user_message', seq: 1, payload: { content: 'Read file' } }),
      ev({ type: 'tool_call_start', seq: 2, payload: { toolCallId: 't1', toolName: 'read_file', args: { path: 'foo.txt' } } }),
      ev({ type: 'tool_call_result', seq: 3, payload: { toolCallId: 't1', toolName: 'read_file', result: 'file content' } }),
    ])
    expect(state.toolCalls).toHaveLength(1)
    expect(state.toolCalls[0].toolName).toBe('read_file')
    expect(state.toolCalls[0].status).toBe('done')
    expect(state.toolCalls[0].result).toBe('file content')
  })

  it('should collect pending permissions', () => {
    const state = reduceEvents([
      ev({ type: 'permission_requested', seq: 1, payload: { permissionId: 'p1', toolName: 'bash', toolCallId: 't1', args: { command: 'rm -rf /' }, reason: 'potentially dangerous' } }),
    ])
    expect(state.pendingPermissions).toHaveLength(1)
    expect(state.pendingPermissions[0].toolName).toBe('bash')
    expect(state.pendingPermissions[0].status).toBe('pending')
  })

  it('should resolve permissions', () => {
    const state = reduceEvents([
      ev({ type: 'permission_requested', seq: 1, payload: { permissionId: 'p1', toolName: 'bash', toolCallId: 't1', args: {}, reason: '' } }),
      ev({ type: 'permission_resolved', seq: 2, payload: { permissionId: 'p1', toolName: 'bash', resolution: 'allow' } }),
    ])
    expect(state.pendingPermissions).toHaveLength(0)
  })

  it('should interleave tool calls and messages in order', () => {
    const state = reduceEvents([
      ev({ type: 'user_message', seq: 1, payload: { content: 'Fix bug' } }),
      ev({ type: 'assistant_text_delta', seq: 2, payload: { text: 'Let me read the file' } }),
      ev({ type: 'assistant_text_done', seq: 3, payload: { text: 'Let me read the file' } }),
      ev({ type: 'tool_call_start', seq: 4, payload: { toolCallId: 't1', toolName: 'read_file', args: {} } }),
      ev({ type: 'tool_call_result', seq: 5, payload: { toolCallId: 't1', toolName: 'read_file', result: 'ok' } }),
      ev({ type: 'assistant_text_delta', seq: 6, payload: { text: 'Fixed!' } }),
      ev({ type: 'assistant_text_done', seq: 7, payload: { text: 'Fixed!' } }),
    ])
    // Should have: user message, assistant message, tool call, assistant message
    expect(state.messages).toHaveLength(3) // 2 user/assistant messages
    expect(state.toolCalls).toHaveLength(1)
  })

  it('should handle reasoning in assistant_text_delta', () => {
    const state = reduceEvents([
      ev({ type: 'user_message', seq: 1, payload: { content: 'Why?' } }),
      ev({ type: 'assistant_text_delta', seq: 2, payload: { text: '', reasoning: 'Thinking...' } }),
      ev({ type: 'assistant_text_delta', seq: 3, payload: { text: 'Because' } }),
      ev({ type: 'assistant_text_done', seq: 4, payload: { text: 'Because', reasoning: 'Thinking...' } }),
    ])
    expect(state.messages).toHaveLength(2)
    expect(state.messages[1].reasoning).toBe('Thinking...')
  })

  it('should handle error status', () => {
    const state = reduceEvents([
      ev({ type: 'status', seq: 1, payload: { status: 'error', message: 'Something went wrong' } }),
    ])
    expect(state.status).toBe('error')
    expect(state.error).toBe('Something went wrong')
    expect(state.isThinking).toBe(false)
  })

  it('should maintain max seq', () => {
    const state = reduceEvents([
      ev({ type: 'user_message', seq: 5, payload: { content: 'Hi' } }),
      ev({ type: 'status', seq: 10, payload: { status: 'working' } }),
    ])
    expect(state.lastSeq).toBe(10)
  })
})
