import fs from 'node:fs'
import path from 'node:path'
import type { Event, WatchdogConfig } from '@pocket/core'
import { DEFAULT_WATCHDOG_CONFIG } from '@pocket/core'

export interface HealthVerdict {
  verdict: 'continue' | 'nudge'
  reason: string
  nudgeText?: string
}

interface HealthSignals {
  intentWithoutAction: boolean
  toolRepetition: boolean
  noDeltaTurns: number
  toolErrorStreak: number
}

const ACTION_ANNOUNCE = /(?:let me|i'?ll|now i|next,? i)\s+(?:update|edit|modify|fix|add|remove|create|run|write|implement)/i
const ENDS_WITH_QUESTION = /[?]$|which do you prefer|should i|want me to|would you/i

const WRITE_TOOL_NAMES = new Set([
  'write_file', 'edit_file', 'bash', 'bash_background',
  'git_create_branch', 'git_commit', 'git_push', 'github_create_pr',
  'plan', 'todos_write',
])

export class HealthMonitor {
  private config: WatchdogConfig
  private sessionId: string
  private logPath: string

  private assistantText = ''
  private hasToolCallsThisTurn = false
  private turnToolCallKeys: string[] = []
  private hasWriteOrExecSuccess = false
  private hasToolErrorThisTurn = false
  private pendingReadPaths = new Map<string, string>()

  private recentToolCallKeys: string[] = []
  private filesReadThisRun = new Set<string>()
  private consecutiveNoDeltaTurns = 0
  private consecutiveToolErrors = 0
  private turnCount = 0

  private pendingNudge: string | null = null

  constructor(sessionId: string, config?: Partial<WatchdogConfig>, logPath?: string) {
    this.sessionId = sessionId
    this.config = { ...DEFAULT_WATCHDOG_CONFIG, ...config }
    const home = process.env.HOME || process.env.USERPROFILE || '~'
    this.logPath = logPath ?? path.join(home, '.pocket', 'watchdog.jsonl')
  }

  feed(event: Event): void {
    switch (event.type) {
      case 'assistant_text_delta': {
        this.assistantText += event.payload.text || ''
        break
      }
      case 'assistant_text_done': {
        this.assistantText = event.payload.text || ''
        break
      }
      case 'tool_call_start': {
        this.hasToolCallsThisTurn = true
        const key = `${event.payload.toolName}:${JSON.stringify(event.payload.args)}`
        this.turnToolCallKeys.push(key)

        if (event.payload.toolName === 'read_file') {
          const filePath = event.payload.args.filePath as string | undefined
          if (filePath) {
            this.pendingReadPaths.set(event.payload.toolCallId, filePath)
          }
        }
        break
      }
      case 'tool_call_result': {
        if (event.payload.error) {
          this.hasToolErrorThisTurn = true
          break
        }

        const pendingPath = this.pendingReadPaths.get(event.payload.toolCallId)
        if (pendingPath) {
          this.pendingReadPaths.delete(event.payload.toolCallId)
          if (!this.filesReadThisRun.has(pendingPath)) {
            this.filesReadThisRun.add(pendingPath)
            this.hasWriteOrExecSuccess = true
          }
        }

        if (WRITE_TOOL_NAMES.has(event.payload.toolName)) {
          this.hasWriteOrExecSuccess = true
        }
        break
      }
    }
  }

  evaluate(): HealthVerdict {
    this.updateCrossTurnState()

    const signals = this.computeSignals()

    const result = this.decide(signals)

    this.resetPerTurnState()

    return result
  }

  resetForNewUserTurn(): void {
    this.consecutiveNoDeltaTurns = 0
    this.consecutiveToolErrors = 0
    this.recentToolCallKeys = []
    this.pendingNudge = null
    this.assistantText = ''
    this.hasToolCallsThisTurn = false
    this.turnToolCallKeys = []
    this.hasWriteOrExecSuccess = false
    this.hasToolErrorThisTurn = false
    this.pendingReadPaths.clear()
    this.turnCount = 0
  }

  consumeNudge(): string | null {
    const nudge = this.pendingNudge
    this.pendingNudge = null
    return nudge
  }

  getConfig(): WatchdogConfig {
    return { ...this.config }
  }

  getTurnCount(): number {
    return this.turnCount
  }

  private updateCrossTurnState(): void {
    for (const key of this.turnToolCallKeys) {
      const toolName = key.split(':')[0]
      if (WRITE_TOOL_NAMES.has(toolName)) {
        this.recentToolCallKeys.push(key)
      }
    }

    if (this.hasWriteOrExecSuccess) {
      this.consecutiveNoDeltaTurns = 0
      this.consecutiveToolErrors = 0
    } else {
      this.consecutiveNoDeltaTurns++
    }

    if (this.hasToolErrorThisTurn) {
      this.consecutiveToolErrors++
    } else if (this.hasWriteOrExecSuccess) {
      this.consecutiveToolErrors = 0
    }
  }

  private computeSignals(): HealthSignals {
    return {
      intentWithoutAction: this.checkIntentWithoutAction(),
      toolRepetition: this.checkToolRepetition(),
      noDeltaTurns: this.consecutiveNoDeltaTurns,
      toolErrorStreak: this.consecutiveToolErrors,
    }
  }

  private checkIntentWithoutAction(): boolean {
    const text = this.assistantText.trim()
    if (!text) return false
    return (
      ACTION_ANNOUNCE.test(text) &&
      !this.hasToolCallsThisTurn &&
      !ENDS_WITH_QUESTION.test(text)
    )
  }

  private checkToolRepetition(): boolean {
    const n = this.config.toolRepetitionCount
    if (this.recentToolCallKeys.length < n) return false
    const lastN = this.recentToolCallKeys.slice(-n)
    return new Set(lastN).size === 1
  }

  private decide(signals: HealthSignals): HealthVerdict {
    if (signals.toolErrorStreak >= this.config.maxToolErrorStreak) {
      return this.emitNudge(
        'tool_error_streak',
        `[watchdog] ${signals.toolErrorStreak} consecutive tool errors. Explain what's failing and ask the user how to proceed.`,
      )
    }

    if (signals.toolRepetition && signals.noDeltaTurns >= 2) {
      return this.emitNudge(
        'tool_repetition',
        '[watchdog] Identical tool calls repeated with no progress. Re-read the target file, then try a different approach.',
      )
    }

    if (signals.intentWithoutAction) {
      return this.emitNudge(
        'intent_without_action',
        '[watchdog] You announced an action but didn\'t call the tool. Call it now or explain why not.',
      )
    }

    if (signals.noDeltaTurns >= this.config.noDeltaNudgeAt) {
      const n = signals.noDeltaTurns
      if (n >= 6) {
        return this.emitNudge(
          'no_state_delta',
          `[watchdog] ${n} turns with no changes. You appear stuck. Explain what you've tried and ask the user for guidance.`,
        )
      }
      return this.emitNudge(
        'no_state_delta',
        `[watchdog] ${n} turns with no changes. What is blocking progress? Surface the blocker or change approach.`,
      )
    }

    return { verdict: 'continue', reason: 'ok' }
  }

  private emitNudge(reason: string, nudgeText: string): HealthVerdict {
    this.pendingNudge = nudgeText

    if (reason === 'tool_repetition') {
      this.recentToolCallKeys = []
    }
    if (reason === 'tool_error_streak') {
      this.consecutiveToolErrors = 0
      this.recentToolCallKeys = []
    }

    this.logVerdict('nudge', reason)
    return { verdict: 'nudge', reason, nudgeText }
  }

  private resetPerTurnState(): void {
    this.assistantText = ''
    this.hasToolCallsThisTurn = false
    this.turnToolCallKeys = []
    this.hasWriteOrExecSuccess = false
    this.hasToolErrorThisTurn = false
    this.pendingReadPaths.clear()
    this.turnCount++
  }

  private logVerdict(verdict: string, reason: string): void {
    try {
      const dir = path.dirname(this.logPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const entry = JSON.stringify({
        ts: Date.now(),
        sessionId: this.sessionId,
        turn: this.turnCount,
        signals: {
          intentWithoutAction: this.checkIntentWithoutAction(),
          toolRepetition: this.checkToolRepetition(),
          noDeltaTurns: this.consecutiveNoDeltaTurns,
          toolErrorStreak: this.consecutiveToolErrors,
        },
        verdict,
        reason,
      }) + '\n'
      fs.appendFileSync(this.logPath, entry)
    } catch {
      // best-effort
    }
  }
}
