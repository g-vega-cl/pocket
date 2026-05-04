import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { DEFAULT_PROTECTED_BRANCHES, DEFAULT_SANDBOX_IMAGE, DEFAULT_BASH_DENY } from '../index.js'
import type {
  Event,
  EventType,
  SessionMeta,
  Message,
  Tool,
  ToolContext,
  ToolDefinition,
  Progress,
  PermissionRequest,
  LLMChunk,
  LLMProvider,
  ChatRequest,
  ChatUsage,
  BackgroundProcess,
} from '../index.js'

describe('core types', () => {
  it('should allow constructing a valid Event', () => {
    const event: Event<'status'> = {
      seq: 1,
      ts: Date.now(),
      type: 'status',
      payload: { status: 'working' },
    }
    expect(event.seq).toBe(1)
    expect(event.type).toBe('status')
    expect(event.payload.status).toBe('working')
  })

  it('should allow constructing a SessionMeta', () => {
    const session: SessionMeta = {
      id: 'test-session',
      repoUrl: 'https://github.com/user/repo',
      task: 'fix bug',
      model: 'openai/gpt-4o',
      branchName: null,
      localPath: null,
      status: 'creating',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      nextSeq: 1,
      isLocal: false,
    }
    expect(session.id).toBe('test-session')
    expect(session.status).toBe('creating')
  })

  it('should allow building a Tool with ZodSchema', () => {
    const readFileInput = z.object({ path: z.string() })
    const tool: Tool<{ path: string }, string> = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: readFileInput,
      isReadOnly: true,
      defaultPermission: 'allow',
      async *call(input, _ctx) {
        yield { type: 'progress' as const, message: `Reading ${input.path}` }
        return `content of ${input.path}`
      },
    }
    expect(tool.name).toBe('read_file')
    expect(tool.isReadOnly).toBe(true)
  })

  it('should validate ToolDefinition for LLM', () => {
    const def: ToolDefinition = {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    }
    expect(def.type).toBe('function')
    expect(def.function.name).toBe('read_file')
  })

  it('should allow LLMProvider interface usage', () => {
    const provider: LLMProvider = {
      async *streamChat(_req: ChatRequest): AsyncGenerator<LLMChunk, ChatUsage> {
        yield { type: 'text', text: 'hello' }
        return { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      },
      countTokens(messages: Message[]): number {
        let total = 0
        for (const m of messages) {
          total += (m.content ?? '').length
        }
        return total
      },
      capabilities(_model: string) {
        return { contextWindow: 128000, supportsTools: true, supportsReasoning: false }
      },
    }
    expect(provider.capabilities('test')).toEqual({
      contextWindow: 128000,
      supportsTools: true,
      supportsReasoning: false,
    })
  })

  it('should export default protected branches', () => {
    expect(DEFAULT_PROTECTED_BRANCHES).toContain('main')
    expect(DEFAULT_PROTECTED_BRANCHES).toContain('master')
  })

  it('should export default sandbox image', () => {
    expect(DEFAULT_SANDBOX_IMAGE).toBe('docker.io/nikolaik/python-nodejs:python3.12-nodejs22')
    expect(typeof DEFAULT_SANDBOX_IMAGE).toBe('string')
    expect(DEFAULT_SANDBOX_IMAGE.length).toBeGreaterThan(0)
  })

  it('should export default bash deny patterns', () => {
    expect(Array.isArray(DEFAULT_BASH_DENY)).toBe(true)
    expect(DEFAULT_BASH_DENY.length).toBeGreaterThan(0)
    expect(DEFAULT_BASH_DENY.some(p => /rm -rf/.test(p))).toBe(true)
    expect(DEFAULT_BASH_DENY.some(p => /sudo/.test(p))).toBe(true)
  })

  it('should allow constructing BackgroundProcess', () => {
    const proc: BackgroundProcess = {
      id: 'proc_abc',
      pid: 12345,
      command: 'npm run dev',
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      cwd: '/workspace',
    }
    expect(proc.id).toBe('proc_abc')
    expect(proc.status).toBe('running')
  })

  it('should distinguish EventPayload types', () => {
    const events: Event<EventType>[] = [
      { seq: 0, ts: 1, type: 'user_message', payload: { content: 'hi' } },
      { seq: 1, ts: 2, type: 'assistant_text_delta', payload: { text: 'Hello' } },
      { seq: 2, ts: 3, type: 'tool_call_start', payload: { toolCallId: 'tc1', toolName: 'bash', args: {} } },
      { seq: 3, ts: 4, type: 'tool_call_result', payload: { toolCallId: 'tc1', toolName: 'bash', result: 'ok' } },
      { seq: 4, ts: 5, type: 'permission_requested', payload: { permissionId: 'p1', toolName: 'bash', toolCallId: 'tc2', args: {}, reason: 'bash' } },
      { seq: 5, ts: 6, type: 'permission_resolved', payload: { permissionId: 'p1', toolName: 'bash', resolution: 'allow' } },
    ]
    expect(events).toHaveLength(6)
    expect(events[0].type).toBe('user_message')
    expect(events[4].type).toBe('permission_requested')
  })

  it('should have all status values', () => {
    const statuses = ['creating', 'cloning', 'ready', 'working', 'idle', 'awaiting_permission', 'awaiting_plan_approval', 'done', 'error', 'interrupted']
    for (const s of statuses) {
      const meta: SessionMeta = {
        id: 'x', repoUrl: '', task: '', model: '', branchName: null, localPath: null,
        status: s as SessionMeta['status'], createdAt: 1, lastActivity: 1, nextSeq: 1, isLocal: false,
      }
      expect(meta.status).toBe(s)
    }
  })
})
