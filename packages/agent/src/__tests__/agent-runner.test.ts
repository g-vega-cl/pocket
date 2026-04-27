import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { EventLog } from '../event-log.js'
import { AgentRunner } from '../agent-runner.js'
import { ToolRegistry } from '../tool-registry.js'
import type { Event, LLMChunk, ChatUsage, ChatRequest, ToolContext, Progress, Tool, ToolDefinition } from '@pocket/core'

function makeMockProvider() {
  return {
    streamChat: vi.fn<(...args: [ChatRequest]) => AsyncGenerator<LLMChunk, ChatUsage>>(),
    countTokens: vi.fn(),
    capabilities: vi.fn().mockReturnValue({ contextWindow: 128000, supportsTools: true, supportsReasoning: false }),
  }
}

function makeDummyTool(name: string, isReadOnly: boolean, result?: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({ input: z.string().optional() }),
    isReadOnly,
    defaultPermission: 'allow' as const,
    async *call(input: { input?: string }, _ctx: ToolContext): AsyncGenerator<Progress, string> {
      yield { type: 'progress', message: `Running ${name}` }
      return result ?? `result of ${name}`
    },
  }
}

describe('AgentRunner', () => {
  let tmpDir: string
  let eventLog: EventLog
  let registry: ToolRegistry
  let capturedEvents: Event[]

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pocket-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    eventLog = new EventLog(tmpDir)
    registry = new ToolRegistry()
    capturedEvents = []
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createRunner(model = 'openai/gpt-4o'): AgentRunner {
    const provider = makeMockProvider()
    return new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model,
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'You are a helpful assistant.',
    })
  }

  it('should emit user_message event on start', async () => {
    const provider = makeMockProvider()
    // Simple text-only response, no tool calls
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      yield { type: 'text', text: 'Hello!' }
      return { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'You are a helpful assistant.',
    })

    await runner.runTurn({ role: 'user', content: 'Hi' })

    const userMsgEvents = capturedEvents.filter(e => e.type === 'user_message')
    expect(userMsgEvents).toHaveLength(1)
    expect(userMsgEvents[0].payload.content).toBe('Hi')
  })

  it('should emit assistant_text_delta events', async () => {
    const provider = makeMockProvider()
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      yield { type: 'text', text: 'Hello' }
      yield { type: 'text', text: ' world' }
      return { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'You are a helper.',
    })

    await runner.runTurn({ role: 'user', content: 'Hi' })

    const textEvents = capturedEvents.filter(e => e.type === 'assistant_text_delta')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0].payload.text).toBe('Hello')
    expect(textEvents[1].payload.text).toBe(' world')
  })

  it('should emit status events (working → idle)', async () => {
    const provider = makeMockProvider()
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      yield { type: 'text', text: 'Done' }
      return { promptTokens: 5, completionTokens: 2, totalTokens: 7 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'You are a helper.',
    })

    await runner.runTurn({ role: 'user', content: 'Hi' })

    const statusEvents = capturedEvents.filter(e => e.type === 'status')
    const statuses = statusEvents.map(e => e.payload.status)
    expect(statuses).toContain('working')
    expect(statuses).toContain('idle')
  })

  it('should execute tool calls and emit tool_call_result events', async () => {
    registry.register(makeDummyTool('my_tool', false, 'tool output'))

    const provider = makeMockProvider()
    let firstCall = true
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      if (firstCall) {
        firstCall = false
        // Return with tool call
        yield { type: 'tool_call', toolCall: { id: 'call_1', name: 'my_tool', arguments: '{"input":"test"}' } }
        return { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      }
      // Second call: final text response
      yield { type: 'text', text: 'Tool done' }
      return { promptTokens: 20, completionTokens: 5, totalTokens: 25 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'You are a helper.',
    })

    await runner.runTurn({ role: 'user', content: 'Run tool' })

    const toolStartEvents = capturedEvents.filter(e => e.type === 'tool_call_start')
    const toolResultEvents = capturedEvents.filter(e => e.type === 'tool_call_result')

    expect(toolStartEvents).toHaveLength(1)
    expect(toolStartEvents[0].payload.toolName).toBe('my_tool')

    expect(toolResultEvents).toHaveLength(1)
    expect(toolResultEvents[0].payload.toolName).toBe('my_tool')
    expect(toolResultEvents[0].payload.result).toBe('tool output')
  })

  it('should stop after max turns (turn cap)', async () => {
    registry.register(makeDummyTool('repeat', false, 'result'))

    const provider = makeMockProvider()
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      yield { type: 'tool_call', toolCall: { id: 'call_1', name: 'repeat', arguments: '{}' } }
      return { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'You are a helper.',
      maxTurns: 3,
    })

    await runner.runTurn({ role: 'user', content: 'Go' })

    const statusEvents = capturedEvents.filter(e => e.type === 'status')
    const lastStatus = statusEvents[statusEvents.length - 1]?.payload.status
    expect(lastStatus).toBe('idle')

    // Check that we didn't exceed max turns
    const toolCalls = capturedEvents.filter(e => e.type === 'tool_call_start')
    expect(toolCalls.length).toBeLessThanOrEqual(3)
  })

  it('should handle abort signal', async () => {
    const provider = makeMockProvider()
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      yield { type: 'text', text: 'Part 1' }
      // Simulate a long pause
      await new Promise(resolve => setTimeout(resolve, 100))
      yield { type: 'text', text: 'Part 2' }
      return { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'Helper',
    })

    // Abort after a short delay
    const runPromise = runner.runTurn({ role: 'user', content: 'Hi' })
    setTimeout(() => runner.abort(), 10)
    await runPromise

    // Should have emitted some text but not all (aborted mid-stream)
    const textEvents = capturedEvents.filter(e => e.type === 'assistant_text_delta')
    // We should have at most 1 text delta before abort
    expect(textEvents.length).toBeLessThanOrEqual(1)
  })

  it('should append events to the event log on disk', async () => {
    const provider = makeMockProvider()
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      yield { type: 'text', text: 'Response' }
      return { promptTokens: 5, completionTokens: 3, totalTokens: 8 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'Helper',
    })

    await runner.runTurn({ role: 'user', content: 'Hi' })

    // Events should be on disk too
    const eventsOnDisk = eventLog.replaySync('sess_test')
    expect(eventsOnDisk.length).toBeGreaterThan(0)
    expect(eventsOnDisk.some(e => e.type === 'user_message')).toBe(true)
    expect(eventsOnDisk.some(e => e.type === 'assistant_text_delta')).toBe(true)
  })

  it('should handle error from tool execution', async () => {
    const failingTool: Tool = {
      name: 'fail_tool',
      description: 'Always fails',
      inputSchema: z.object({}),
      isReadOnly: false,
      defaultPermission: 'allow',
      async *call(_input: Record<string, unknown>, _ctx: ToolContext): AsyncGenerator<Progress, string> {
        throw new Error('Tool failure!')
      },
    }
    registry.register(failingTool)

    const provider = makeMockProvider()
    let firstCall = true
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      if (firstCall) {
        firstCall = false
        yield { type: 'tool_call', toolCall: { id: 'call_1', name: 'fail_tool', arguments: '{}' } }
        return { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      }
      yield { type: 'text', text: 'Handled error' }
      return { promptTokens: 20, completionTokens: 5, totalTokens: 25 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'Helper',
    })

    await runner.runTurn({ role: 'user', content: 'Test' })

    const toolResultEvents = capturedEvents.filter(e => e.type === 'tool_call_result')
    expect(toolResultEvents).toHaveLength(1)
    expect(toolResultEvents[0].payload.error).toBe('Tool failure!')
  })

  it('should pass tool definitions to LLM', async () => {
    registry.register(makeDummyTool('tool_x', true))

    const provider = makeMockProvider()
    provider.streamChat.mockImplementation(async function* (): AsyncGenerator<LLMChunk, ChatUsage> {
      yield { type: 'text', text: 'Ok' }
      return { promptTokens: 5, completionTokens: 2, totalTokens: 7 }
    })

    const runner = new AgentRunner({
      sessionId: 'sess_test',
      provider: provider as any,
      eventLog,
      tools: registry,
      model: 'openai/gpt-4o',
      onEvent: (event) => capturedEvents.push(event),
      systemPrompt: 'Helper',
    })

    await runner.runTurn({ role: 'user', content: 'Hi' })

    expect(provider.streamChat).toHaveBeenCalled()
    const callArgs = provider.streamChat.mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools!.length).toBe(1)
    expect(callArgs.tools![0].function.name).toBe('tool_x')
  })
})
