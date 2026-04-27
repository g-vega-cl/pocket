import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../tool-registry.js'
import type { Tool, ToolContext, Progress } from '@pocket/core'

function makeDummyTool(name: string, isReadOnly: boolean): Tool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({ input: z.string() }),
    isReadOnly,
    defaultPermission: 'allow',
    async *call(input: { input: string }, _ctx: ToolContext): AsyncGenerator<Progress, string> {
      yield { type: 'progress', message: `Running ${name}` }
      return `result of ${input.input}`
    },
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it('should register a tool', () => {
    const tool = makeDummyTool('my_tool', true)
    registry.register(tool)
    expect(registry.get('my_tool')).toBe(tool)
  })

  it('should return undefined for unregistered tool', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('should list all registered tools', () => {
    registry.register(makeDummyTool('tool_a', true))
    registry.register(makeDummyTool('tool_b', false))
    expect(registry.list()).toHaveLength(2)
  })

  it('should replace tool with same name', () => {
    const tool1 = makeDummyTool('same_name', true)
    const tool2 = makeDummyTool('same_name', false)
    registry.register(tool1)
    registry.register(tool2)
    expect(registry.list()).toHaveLength(1)
    expect(registry.get('same_name')!.isReadOnly).toBe(false)
  })

  it('should generate tool definitions for LLM', () => {
    registry.register(makeDummyTool('tool_a', true))
    const defs = registry.toDefinitions()
    expect(defs).toHaveLength(1)
    expect(defs[0].type).toBe('function')
    expect(defs[0].function.name).toBe('tool_a')
    expect(defs[0].function.parameters).toBeDefined()
  })

  it('should return read-only tools separately', () => {
    registry.register(makeDummyTool('read_a', true))
    registry.register(makeDummyTool('read_b', true))
    registry.register(makeDummyTool('write_a', false))

    const readOnly = registry.getReadOnly()
    expect(readOnly).toHaveLength(2)

    const writable = registry.getWritable()
    expect(writable).toHaveLength(1)
  })

  it('should check if tool exists', () => {
    registry.register(makeDummyTool('exists', true))
    expect(registry.has('exists')).toBe(true)
    expect(registry.has('nope')).toBe(false)
  })

  it('should register multiple tools at once', () => {
    registry.registerAll([
      makeDummyTool('a', true),
      makeDummyTool('b', false),
      makeDummyTool('c', true),
    ])
    expect(registry.list()).toHaveLength(3)
  })
})
