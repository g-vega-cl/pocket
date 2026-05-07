import type { Event, Message, ToolCall, ToolContext, Progress, WatchdogConfig } from '@pocket/core'
import type { LLMProvider, LLMChunk } from '@pocket/core'
import path from 'node:path'
import type { EventLog } from './event-log.js'
import type { ToolRegistry } from './tool-registry.js'
import type { PermissionGate } from './permission-gate.js'
import { HealthMonitor } from './health-monitor.js'
import { buildConversationFromEvents } from './conversation-builder.js'

interface AgentRunnerOptions {
  sessionId: string
  provider: LLMProvider
  eventLog: EventLog
  tools: ToolRegistry
  model: string
  systemPrompt?: string
  maxTurns?: number
  startingSeq?: number
  workspaceRoot?: string
  githubToken?: string
  sandboxImage?: string
  onEvent?: (event: Event) => void
  permissionGate?: PermissionGate
  onPermissionAlwaysAllow?: (toolName: string) => void
  watchdogConfig?: Partial<WatchdogConfig>
}

export class AgentRunner {
  private sessionId: string
  private provider: LLMProvider
  private eventLog: EventLog
  private tools: ToolRegistry
  private model: string
  private systemPrompt: string
  private maxTurns: number
  private abortController: AbortController
  private seq: number
  private onEvent?: (event: Event) => void
  private workspaceRoot: string
  private githubToken?: string
  private sandboxImage?: string
  private permissionGate?: PermissionGate
  private onPermissionAlwaysAllow?: (toolName: string) => void
  private recentToolCallKeys: string[] = []
  private readonly MAX_REPEAT_CALLS = 3
  private pendingPermissions = new Map<string, {
    resolve: (allowed: boolean) => void
    toolName: string
  }>()
  private monitor: HealthMonitor
  private pendingNudge: string | null = null

  constructor(options: AgentRunnerOptions) {
    this.sessionId = options.sessionId
    this.provider = options.provider
    this.eventLog = options.eventLog
    this.tools = options.tools
    this.model = options.model
    this.systemPrompt = options.systemPrompt ?? 'You are Pocket, an autonomous coding agent.'
    this.abortController = new AbortController()
    this.seq = options.startingSeq ?? 1
    this.onEvent = options.onEvent
    this.workspaceRoot = options.workspaceRoot ?? ''
    this.githubToken = options.githubToken
    this.sandboxImage = options.sandboxImage
    this.permissionGate = options.permissionGate
    this.onPermissionAlwaysAllow = options.onPermissionAlwaysAllow
    this.recentToolCallKeys = []
    this.monitor = new HealthMonitor(this.sessionId, options.watchdogConfig)
    this.maxTurns = options.maxTurns ?? this.monitor.getConfig().maxTurns
  }

  abort(): void {
    this.abortController.abort()
    // Reject all pending permissions so the turn doesn't hang
    for (const [permissionId, { resolve }] of this.pendingPermissions) {
      resolve(false)
      this.pendingPermissions.delete(permissionId)
    }
  }

  async resolvePermission(
    permissionId: string,
    resolution: 'allow' | 'deny',
    alwaysAllow?: boolean,
  ): Promise<void> {
    const p = this.pendingPermissions.get(permissionId)
    if (!p) return

    if (resolution === 'allow' && alwaysAllow) {
      this.permissionGate?.setSessionRule(this.sessionId, p.toolName, 'allow')
      this.onPermissionAlwaysAllow?.(p.toolName)
    }

    this.pendingPermissions.delete(permissionId)
    p.resolve(resolution === 'allow')
  }

  getSessionId(): string {
    return this.sessionId
  }

  getSeq(): number {
    return this.seq
  }

  get isAborted(): boolean {
    return this.abortController.signal.aborted
  }

  async runTurn(userMessage: { role: 'user'; content: string }): Promise<void> {
    console.log(`[Pocket] AgentRunner: runTurn() started for session ${this.sessionId}`)

    // Reset loop-detection state for each new user turn
    this.recentToolCallKeys = []
    this.monitor.resetForNewUserTurn()

    // Emit user message event
    this.emit({
      type: 'user_message',
      payload: { content: userMessage.content },
    })

    this.emit({
      type: 'status',
      payload: { status: 'working' },
    })

    // Emit initial token usage so the UI shows 0/contextWindow immediately
    const contextWindow = this.provider.capabilities(this.model).contextWindow
    this.emit({
      type: 'token_usage',
      payload: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        contextWindow,
      },
    })

    let turnCount = 0

    try {
      while (turnCount < this.maxTurns && !this.abortController.signal.aborted) {
        console.log(`[Pocket] AgentRunner: turn ${turnCount + 1}/${this.maxTurns} for session ${this.sessionId}`)
        const messages = this.buildMessages(userMessage)
        const toolDefs = this.tools.toDefinitions()

        let assistantText = ''
        let reasoning = ''
        const toolCalls: ToolCall[] = []
        let actualModel: string | undefined

        const stream = this.provider.streamChat({
          model: this.model,
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
        })

        let usageResult = null
        let streamResult = await stream.next()

        while (!streamResult.done && !this.abortController.signal.aborted) {
          const chunk: LLMChunk = streamResult.value

          // Track the actual model used (may differ from requested due to fallback)
          if (chunk.model) {
            actualModel = chunk.model
          }

          if (chunk.type === 'text' && chunk.text) {
            assistantText += chunk.text
            this.emit({
              type: 'assistant_text_delta',
              payload: { text: chunk.text },
            })
          } else if (chunk.type === 'reasoning' && chunk.reasoning) {
            reasoning += chunk.reasoning
            // Reasoning is emitted as text delta with reasoning field
            this.emit({
              type: 'assistant_text_delta',
              payload: { text: '', reasoning: chunk.reasoning },
            })
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            const tc = chunk.toolCall
            toolCalls.push({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            })
          }

          streamResult = await stream.next()
        }

        usageResult = streamResult.value

        // Emit token usage if available
        if (usageResult && typeof usageResult === 'object' && 'totalTokens' in usageResult) {
          this.emit({
            type: 'token_usage',
            payload: {
              promptTokens: (usageResult as any).promptTokens ?? 0,
              completionTokens: (usageResult as any).completionTokens ?? 0,
              totalTokens: (usageResult as any).totalTokens ?? 0,
              contextWindow: this.provider.capabilities(this.model).contextWindow,
            },
          })
        }

        // Emit assistant text done with actual model info
        this.emit({
          type: 'assistant_text_done',
          payload: {
            text: assistantText,
            reasoning: reasoning || undefined,
            model: actualModel || this.model,
          },
        })

        // If no tool calls, break
        if (toolCalls.length === 0) {
          console.log(`[Pocket] AgentRunner: no tool calls, breaking loop for session ${this.sessionId}`)
          break
        }

        turnCount++

        console.log(`[Pocket] AgentRunner: executing ${toolCalls.length} tool call(s) for session ${this.sessionId} (turn ${turnCount})`)

        // Execute tools
        const results = await this.executeTools(toolCalls)

        // Emit tool call results
        for (const result of results) {
          this.emit({
            type: 'tool_call_result',
            payload: {
              toolCallId: result.toolCallId,
              toolName: result.toolName,
              result: result.result,
              error: result.error,
            },
          })
        }

        // Watchdog evaluation
        const verdict = this.monitor.evaluate()
        if (verdict.nudgeText) {
          this.pendingNudge = verdict.nudgeText
        }
      }

      // Check if we hit the turn cap
      if (turnCount >= this.maxTurns) {
        this.emit({
          type: 'status',
          payload: { status: 'idle', message: 'Turn limit reached' },
        })
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Pocket] AgentRunner: runTurn() error for session ${this.sessionId}: ${message}`)
      if (error instanceof Error && error.stack) {
        console.error(`[Pocket] AgentRunner: stack trace: ${error.stack}`)
      }

      if (this.abortController.signal.aborted) {
        console.log(`[Pocket] AgentRunner: turn aborted for session ${this.sessionId}`)
        this.emit({
          type: 'status',
          payload: { status: 'idle', message: 'Aborted' },
        })
      } else {
        this.emit({
          type: 'status',
          payload: { status: 'error', message },
        })
      }
      return
    }

    if (!this.abortController.signal.aborted) {
      console.log(`[Pocket] AgentRunner: runTurn() completed for session ${this.sessionId} (turns=${turnCount})`)
      this.emit({
        type: 'status',
        payload: { status: 'idle' },
      })
    }
  }

  private buildMessages(_userMessage: { role: 'user'; content: string }): Message[] {
    const events = this.eventLog.replaySync(this.sessionId)
    const nudge = this.monitor.consumeNudge()

    const messages = buildConversationFromEvents(events, {
      systemPrompt: this.systemPrompt,
      nudgeText: nudge ?? undefined,
    })

    // Token cap check
    const tokens = this.provider.countTokens(messages)
    const window = this.provider.capabilities(this.model).contextWindow
    const pressure = tokens / window
    if (pressure > 0.90) {
      this.emit({
        type: 'status',
        payload: { status: 'error', message: `Token limit: ${tokens}/${window} (90%+). Start a new session.` },
      })
    } else if (pressure > 0.75) {
      this.emit({
        type: 'status',
        payload: { status: 'working', message: `Token warning: ${tokens}/${window} (${Math.round(pressure * 100)}%).` },
      })
    }

    return messages
  }

  private async executeTools(toolCalls: ToolCall[]): Promise<Array<{ toolCallId: string; toolName: string; result?: unknown; error?: string }>> {
    // Separate read-only and write tools
    const readOnly: ToolCall[] = []
    const write: ToolCall[] = []

    for (const tc of toolCalls) {
      const tool = this.tools.get(tc.function.name)
      if (tool?.isReadOnly) {
        readOnly.push(tc)
      } else {
        write.push(tc)
      }
    }

    const results: Array<{ toolCallId: string; toolName: string; result?: unknown; error?: string }> = []
    const ctx: ToolContext = {
      sessionId: this.sessionId,
      workspaceRoot: this.workspaceRoot,
      githubToken: this.githubToken,
      sandboxImage: this.sandboxImage,
      resolvePath: (inputPath: string) => {
        const resolved = path.resolve(this.workspaceRoot, inputPath)
        if (!resolved.startsWith(this.workspaceRoot)) {
          throw new Error(`Path escapes workspace: ${inputPath}`)
        }
        return resolved
      },
    }

    // Execute read-only tools in parallel
    if (readOnly.length > 0) {
      const parallelResults = await Promise.allSettled(
        readOnly.map(tc => this.executeOneTool(tc, ctx))
      )
      for (let i = 0; i < readOnly.length; i++) {
        const tc = readOnly[i]
        const res = parallelResults[i]
        this.emit({
          type: 'tool_call_start',
          payload: {
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: safeParseJSON(tc.function.arguments),
          },
        })
        if (res.status === 'fulfilled') {
          results.push(res.value)
        } else {
          results.push({
            toolCallId: tc.id,
            toolName: tc.function.name,
            error: res.reason instanceof Error ? res.reason.message : String(res.reason),
          })
        }
      }
    }

    // Execute write tools sequentially
    for (const tc of write) {
      this.emit({
        type: 'tool_call_start',
        payload: {
          toolCallId: tc.id,
          toolName: tc.function.name,
          args: safeParseJSON(tc.function.arguments),
        },
      })
      try {
        const result = await this.executeOneTool(tc, ctx)
        results.push(result)
      } catch (error) {
        results.push({
          toolCallId: tc.id,
          toolName: tc.function.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }

  private async executeOneTool(
    tc: ToolCall,
    ctx: ToolContext,
  ): Promise<{ toolCallId: string; toolName: string; result?: unknown; error?: string }> {
    const tool = this.tools.get(tc.function.name)
    if (!tool) {
      return {
        toolCallId: tc.id,
        toolName: tc.function.name,
        error: `Unknown tool: ${tc.function.name}`,
      }
    }

    let args: Record<string, unknown>
    try {
      args = JSON.parse(tc.function.arguments)
    } catch {
      return {
        toolCallId: tc.id,
        toolName: tc.function.name,
        error: `Invalid JSON arguments: ${tc.function.arguments}`,
      }
    }

    // Validate args against schema
    const validation = tool.inputSchema.safeParse(args)
    if (!validation.success) {
      return {
        toolCallId: tc.id,
        toolName: tc.function.name,
        error: `Invalid arguments: ${validation.error.message}`,
      }
    }

    // ─── Permission check ─────────────────────────────────────
    if (this.permissionGate) {
      let permResult: { resolution: 'allow' | 'ask' | 'deny'; reason?: string }

      if (tc.function.name === 'bash') {
        const command = (args.command as string) ?? ''
        permResult = this.permissionGate.checkBashCommand(command, this.sessionId, this.sandboxImage)
      } else {
        permResult = this.permissionGate.checkPermission({
          tool,
          toolName: tc.function.name,
          args,
          sessionId: this.sessionId,
          workspaceRoot: this.workspaceRoot,
        })
      }

      if (permResult.resolution === 'deny') {
        return {
          toolCallId: tc.id,
          toolName: tc.function.name,
          error: permResult.reason ?? 'Permission denied',
        }
      }

      if (permResult.resolution === 'ask') {
        const permissionId = `perm_${this.seq}_${tc.id}`

        this.emit({
          type: 'permission_requested',
          payload: {
            permissionId,
            toolName: tc.function.name,
            toolCallId: tc.id,
            args,
            reason: permResult.reason ?? `Permission required for ${tc.function.name}`,
          },
        })

        this.emit({
          type: 'status',
          payload: { status: 'awaiting_permission' },
        })

        const allowed = await new Promise<boolean>((resolve) => {
          this.pendingPermissions.set(permissionId, { resolve, toolName: tc.function.name })
        })

        this.emit({
          type: 'permission_resolved',
          payload: {
            permissionId,
            toolName: tc.function.name,
            resolution: allowed ? 'allow' : 'deny',
          },
        })

        this.emit({
          type: 'status',
          payload: { status: 'working' },
        })

        if (!allowed) {
          return {
            toolCallId: tc.id,
            toolName: tc.function.name,
            error: 'Permission denied by user',
          }
        }
      }
    }

    // Detect repeated identical write tool calls to break loops
    if (!tool.isReadOnly) {
      const key = `${tc.function.name}:${tc.function.arguments}`
      this.recentToolCallKeys.push(key)
      if (this.recentToolCallKeys.length > 10) this.recentToolCallKeys.shift()

      const lastN = this.recentToolCallKeys.slice(-this.MAX_REPEAT_CALLS)
      if (lastN.length === this.MAX_REPEAT_CALLS && new Set(lastN).size === 1) {
        return {
          toolCallId: tc.id,
          toolName: tc.function.name,
          error: `Blocked: repeated ${this.MAX_REPEAT_CALLS} identical write tool calls. The model may be stuck in a loop.`,
        }
      }
    }

    try {
      // Run the tool's async generator and collect result
      const gen = tool.call(validation.data, ctx)
      let lastResult = await gen.next()
      while (!lastResult.done) {
        const progress = lastResult.value as Progress
        if (progress.type === 'progress') {
          this.emit({
            type: 'tool_call_progress',
            payload: {
              toolCallId: tc.id,
              toolName: tc.function.name,
              message: progress.message,
            },
          })
        }
        lastResult = await gen.next()
      }
      const value = lastResult.value
      return {
        toolCallId: tc.id,
        toolName: tc.function.name,
        result: value,
      }
    } catch (error) {
      return {
        toolCallId: tc.id,
        toolName: tc.function.name,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private emit(event: Omit<Event, 'seq' | 'ts'>): void {
    const fullEvent = {
      ...event,
      seq: this.seq++,
      ts: Date.now(),
    } as Event

    // Append to event log with fsync
    this.eventLog.append(this.sessionId, fullEvent)

    // Notify listener
    this.onEvent?.(fullEvent)

    // Feed the watchdog monitor
    this.monitor.feed(fullEvent)
  }
}

function safeParseJSON(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}

