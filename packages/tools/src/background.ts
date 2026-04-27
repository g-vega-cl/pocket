import { z } from 'zod'
import type { Tool, ToolContext, Progress } from '@pocket/core'

const bashBgInput = z.object({
  command: z.string().describe('Shell command to run in the background'),
  cwd: z.string().optional().describe('Working directory (defaults to workspace root)'),
})

type BashBgInput = z.infer<typeof bashBgInput>

export function createBackgroundTools(getProcessManager: () => any) {
  const bashBackgroundTool: Tool<BashBgInput, { id: string; pid: number | null }> = {
    name: 'bash_background',
    description: 'Run a shell command in the background. Returns immediately with a process ID. Use bash_read_output to check output later.',
    inputSchema: bashBgInput,
    isReadOnly: false,
    defaultPermission: 'rule-matched',

    async *call(input: BashBgInput, ctx: ToolContext): AsyncGenerator<Progress, { id: string; pid: number | null }> {
      yield { type: 'progress', message: `Starting: ${input.command}` }

      const pm = getProcessManager()
      if (pm.isFull()) {
        throw new Error(`Maximum background processes (${pm.listProcesses().length}) reached. Kill some first.`)
      }

      const proc = await pm.spawn(input.command, input.cwd || ctx.workspaceRoot)
      return { id: proc.id, pid: proc.pid }
    },
  }

  const bashReadOutputInput = z.object({
    id: z.string().describe('Process ID'),
    mode: z.enum(['since_last_read', 'tail', 'all']).describe('Read mode'),
    lines: z.number().optional().describe('Number of lines for tail mode'),
  })

  const bashReadOutputTool: Tool<z.infer<typeof bashReadOutputInput>, {
    stdout: string; stderr: string; isRunning: boolean; droppedLines: number
  }> = {
    name: 'bash_read_output',
    description: 'Read buffered output from a background process',
    inputSchema: bashReadOutputInput,
    isReadOnly: true,
    defaultPermission: 'allow',

    async *call(input: z.infer<typeof bashReadOutputInput>, _ctx: ToolContext): AsyncGenerator<Progress, {
      stdout: string; stderr: string; isRunning: boolean; droppedLines: number
    }> {
      const pm = getProcessManager()
      const result = pm.readOutput(input.id, input.mode, input.lines)
      yield { type: 'progress', message: 'Read output' }
      return result
    },
  }

  const bashSendInputInput = z.object({
    id: z.string().describe('Process ID'),
    input: z.string().describe('Input to send to the process stdin'),
  })

  const bashSendInputTool: Tool<z.infer<typeof bashSendInputInput>, { ok: boolean }> = {
    name: 'bash_send_input',
    description: 'Send input to a background process stdin',
    inputSchema: bashSendInputInput,
    isReadOnly: false,
    defaultPermission: 'ask',

    async *call(input: z.infer<typeof bashSendInputInput>, _ctx: ToolContext): AsyncGenerator<Progress, { ok: boolean }> {
      const pm = getProcessManager()
      const ok = pm.sendInput(input.id, input.input)
      yield { type: 'progress', message: 'Sent input' }
      return { ok }
    },
  }

  const bashKillInput = z.object({
    id: z.string().describe('Process ID'),
  })

  const bashKillTool: Tool<z.infer<typeof bashKillInput>, { exitCode: string; runtimeMs: number }> = {
    name: 'bash_kill',
    description: 'Kill a background process. SIGTERM first, then SIGKILL after 5 seconds.',
    inputSchema: bashKillInput,
    isReadOnly: false,
    defaultPermission: 'allow',

    async *call(input: z.infer<typeof bashKillInput>, _ctx: ToolContext): AsyncGenerator<Progress, { exitCode: string; runtimeMs: number }> {
      const pm = getProcessManager()
      const proc = pm.getProcess(input.id)
      if (!proc) throw new Error(`Process ${input.id} not found`)

      const runtimeMs = Date.now() - proc.startedAt
      pm.kill(input.id)

      yield { type: 'progress', message: 'Killed process' }
      return { exitCode: 'killed', runtimeMs }
    },
  }

  const listProcInput = z.object({})

  const listProcessesTool: Tool<Record<string, never>, Array<{
    id: string; command: string; status: string; runtimeMs: number; hasUnreadOutput: boolean
  }>> = {
    name: 'list_processes',
    description: 'List all background processes for this session',
    inputSchema: listProcInput,
    isReadOnly: true,
    defaultPermission: 'allow',

    async *call(_input: Record<string, never>, _ctx: ToolContext): AsyncGenerator<Progress, Array<{
      id: string; command: string; status: string; runtimeMs: number; hasUnreadOutput: boolean
    }>> {
      const pm = getProcessManager()
      yield { type: 'progress', message: 'Listing processes' }
      return pm.listProcesses().map((p: any) => ({
        ...p,
        runtimeMs: Date.now() - p.startedAt,
      }))
    },
  }

  return {
    bashBackgroundTool,
    bashReadOutputTool,
    bashSendInputTool,
    bashKillTool,
    listProcessesTool,
  }
}
