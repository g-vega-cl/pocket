import type { Tool, ToolDefinition } from '@pocket/core'
import { zodToJsonSchema } from 'zod-to-json-schema'

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool)
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  getReadOnly(): Tool[] {
    return this.list().filter(t => t.isReadOnly)
  }

  getWritable(): Tool[] {
    return this.list().filter(t => !t.isReadOnly)
  }

  toDefinitions(): ToolDefinition[] {
    return this.list().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema),
      },
    }))
  }
}
