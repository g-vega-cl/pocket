import { z } from 'zod'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const planInput = z.object({
  title: z.string().describe('Title of the plan'),
  body: z.string().describe('The plan content in markdown'),
})

type PlanInput = z.infer<typeof planInput>

export const planTool: Tool<PlanInput, { success: boolean }> = {
  name: 'plan',
  description: 'Write a plan for the current task. Use this before making changes to get alignment.',
  inputSchema: planInput,
  isReadOnly: false,
  defaultPermission: 'allow',

  async *call(input: PlanInput, _ctx: ToolContext): AsyncGenerator<Progress, { success: boolean }> {
    yield { type: 'progress', message: `Planning: ${input.title}` }
    return { success: true }
  },
}

const todosInput = z.object({
  todos: z.array(z.object({
    content: z.string().describe('Task description'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('Current status'),
    priority: z.enum(['high', 'medium', 'low']).describe('Priority level'),
  })).describe('The todo list'),
})

type TodosInput = z.infer<typeof todosInput>

export const todosWriteTool: Tool<TodosInput, { success: boolean }> = {
  name: 'todos_write',
  description: 'Create and manage a structured task list for tracking progress. Use this to organize complex tasks.',
  inputSchema: todosInput,
  isReadOnly: false,
  defaultPermission: 'allow',

  async *call(_input: TodosInput, _ctx: ToolContext): AsyncGenerator<Progress, { success: boolean }> {
    yield { type: 'progress', message: 'Updating todos...' }
    return { success: true }
  },
}
