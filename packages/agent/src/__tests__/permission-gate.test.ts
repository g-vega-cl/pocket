import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { PermissionGate } from '../permission-gate.js'
import type { Tool, ToolContext, Progress } from '@pocket/core'

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'test_tool',
    description: 'Test tool',
    inputSchema: z.object({}),
    isReadOnly: false,
    defaultPermission: 'allow',
    async *call(): AsyncGenerator<Progress, string> {
      yield { type: 'progress', message: 'done' }
      return 'done'
    },
    ...overrides,
  }
}

describe('PermissionGate', () => {
  let gate: PermissionGate

  beforeEach(() => {
    gate = new PermissionGate({
      bashAllow: [],
      bashDeny: [],
      protectedBranches: ['main', 'master'],
    })
  })

  it('should allow by default if tool has allow permission', () => {
    const tool = makeTool({ defaultPermission: 'allow' })
    const result = gate.checkPermission({
      tool,
      toolName: 'read_file',
      args: {},
      sessionId: 'sess_1',
      workspaceRoot: '/tmp/workspace',
    })
    expect(result.resolution).toBe('allow')
  })

  it('should return ask for ask-permission tools', () => {
    const tool = makeTool({ defaultPermission: 'ask' })
    const result = gate.checkPermission({
      tool,
      toolName: 'dangerous_tool',
      args: {},
      sessionId: 'sess_1',
      workspaceRoot: '/tmp/workspace',
    })
    expect(result.resolution).toBe('ask')
  })

  it('should honor session-scoped allow rules', () => {
    gate.setSessionRule('sess_1', 'bash', 'allow')
    const tool = makeTool({ name: 'bash', defaultPermission: 'ask' })
    const result = gate.checkPermission({
      tool,
      toolName: 'bash',
      args: {},
      sessionId: 'sess_1',
      workspaceRoot: '/tmp/workspace',
    })
    expect(result.resolution).toBe('allow')
  })

  it('should apply path safety for conditional tools inside workspace', () => {
    const tool = makeTool({ name: 'write_file', defaultPermission: 'conditional' })
    const result = gate.checkPermission({
      tool,
      toolName: 'write_file',
      args: { path: 'foo.txt' },
      sessionId: 'sess_1',
      workspaceRoot: '/tmp/workspace',
    })
    expect(result.resolution).toBe('allow')
  })

  it('should ask for conditional tools outside workspace', () => {
    const tool = makeTool({ name: 'write_file', defaultPermission: 'conditional' })
    const result = gate.checkPermission({
      tool,
      toolName: 'write_file',
      args: { path: '/etc/hosts' },
      sessionId: 'sess_1',
      workspaceRoot: '/tmp/workspace',
    })
    expect(result.resolution).toBe('ask')
  })

  it('should clear session rules', () => {
    gate.setSessionRule('sess_1', 'bash', 'allow')
    gate.clearSessionRules('sess_1')
    const tool = makeTool({ name: 'bash', defaultPermission: 'ask' })
    const result = gate.checkPermission({
      tool,
      toolName: 'bash',
      args: {},
      sessionId: 'sess_1',
      workspaceRoot: '/tmp/workspace',
    })
    expect(result.resolution).toBe('ask')
  })
})
