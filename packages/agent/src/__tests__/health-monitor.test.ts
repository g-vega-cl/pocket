import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HealthMonitor } from '../health-monitor.js'
import type { Event, WatchdogConfig } from '@pocket/core'

function makeEvent(type: string, payload: any): Event {
  return { seq: 0, ts: 0, type: type as any, payload } as Event
}

function textEvent(text: string): Event {
  return makeEvent('assistant_text_delta', { text })
}

function textDoneEvent(text: string): Event {
  return makeEvent('assistant_text_done', { text })
}

function toolStartEvent(toolName: string, args: Record<string, unknown>, id = 'tc1'): Event {
  return makeEvent('tool_call_start', { toolCallId: id, toolName, args })
}

function toolResultEvent(toolName: string, result?: unknown, id = 'tc1'): Event {
  return makeEvent('tool_call_result', { toolCallId: id, toolName, result })
}

function toolErrorEvent(toolName: string, error: string, id = 'tc1'): Event {
  return makeEvent('tool_call_result', { toolCallId: id, toolName, error })
}

function feedTurn(
  monitor: HealthMonitor,
  text: string,
  tools: Array<{ name: string; args: Record<string, unknown>; result?: unknown; error?: string }>,
): void {
  monitor.feed(textEvent(text))
  monitor.feed(textDoneEvent(text))
  for (const t of tools) {
    monitor.feed(toolStartEvent(t.name, t.args, `${t.name}-${tools.indexOf(t)}`))
    if (t.error) {
      monitor.feed(toolErrorEvent(t.name, t.error, `${t.name}-${tools.indexOf(t)}`))
    } else {
      monitor.feed(toolResultEvent(t.name, t.result, `${t.name}-${tools.indexOf(t)}`))
    }
  }
}

function feedTextOnlyTurn(monitor: HealthMonitor, text: string): void {
  monitor.feed(textEvent(text))
  monitor.feed(textDoneEvent(text))
}

function evaluateAndCapture(monitor: HealthMonitor) {
  return monitor.evaluate()
}

describe('HealthMonitor', () => {
  let tmpLog: string
  let monitor: HealthMonitor

  beforeEach(() => {
    tmpLog = path.join(os.tmpdir(), `pocket-watchdog-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
    monitor = new HealthMonitor('sess_test', undefined, tmpLog)
  })

  afterEach(() => {
    try { fs.unlinkSync(tmpLog) } catch { /* ok */ }
  })

  describe('intent_without_action', () => {
    it('fires when text announces action but no tool calls', () => {
      feedTextOnlyTurn(monitor, "Let me update auth.ts to add the login handler")
      const result = monitor.evaluate()
      expect(result.verdict).toBe('nudge')
      expect(result.reason).toBe('intent_without_action')
    })

    it('fires for "I\'ll" variants', () => {
      feedTextOnlyTurn(monitor, "I'll edit the config file")
      const result = monitor.evaluate()
      expect(result.verdict).toBe('nudge')
    })

    it('fires for "Now I" variants', () => {
      feedTextOnlyTurn(monitor, "Now I'll implement the login handler")
      const result = monitor.evaluate()
      expect(result.verdict).toBe('nudge')
    })

    it('fires for "next I" variants', () => {
      feedTextOnlyTurn(monitor, "Next, I'll add the tests")
      const result = monitor.evaluate()
      expect(result.verdict).toBe('nudge')
    })

    it('does not fire when tool calls are present', () => {
      feedTurn(monitor, "Let me update auth.ts", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      const result = monitor.evaluate()
      expect(result.verdict).not.toBe('nudge')
    })

    it('does not fire for "let me know" (no action verb)', () => {
      feedTextOnlyTurn(monitor, "Let me know if you want me to also update the tests")
      const result = monitor.evaluate()
      expect(result.verdict).not.toBe('nudge')
    })

    it('does not fire for "let me explain" (no action verb)', () => {
      feedTextOnlyTurn(monitor, "Let me explain why that approach won't work")
      const result = monitor.evaluate()
      expect(result.verdict).not.toBe('nudge')
    })

    it('does not fire when text ends with a question', () => {
      feedTextOnlyTurn(monitor, "Should I update auth.ts?")
      const result = monitor.evaluate()
      expect(result.verdict).not.toBe('nudge')
    })

    it('does not fire for "which do you prefer" endings', () => {
      feedTextOnlyTurn(monitor, "Let me update auth.ts or create a new module — which do you prefer?")
      const result = monitor.evaluate()
      expect(result.verdict).not.toBe('nudge')
    })

    it('does not fire for empty text', () => {
      feedTextOnlyTurn(monitor, "")
      const result = monitor.evaluate()
      expect(result.verdict).not.toBe('nudge')
    })
  })

  describe('tool_repetition', () => {
    it('fires when last 3 write tool calls are identical and no progress', () => {
      // Turn 1: 3 identical failing calls — blows recentToolCallKeys to 3
      feedTurn(monitor, "trying", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      monitor.evaluate()
      // errorStreak=1, noDeltaTurns=1, recentToolCallKeys=[k,k,k]

      // Turn 2: text-only — no errors, no success → errorStreak stays 1, noDeltaTurns=2
      feedTextOnlyTurn(monitor, "thinking...")
      const result = monitor.evaluate()

      // errorStreak=1 (<3), repetition=true (3 keys), noDeltaTurns=2 → fires
      expect(result.verdict).toBe('nudge')
      expect(result.reason).toBe('tool_repetition')
    })

    it('does not fire when only 2 identical calls (need 3)', () => {
      feedTurn(monitor, "editing 1", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      monitor.evaluate()
      feedTurn(monitor, "editing 2", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      const result = monitor.evaluate()

      // Only 2 keys in recentToolCallKeys, need 3
      expect(result.verdict).not.toBe('nudge')
    })

    it('does not fire when calls differ', () => {
      feedTurn(monitor, "editing", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])

      monitor.evaluate()
      feedTurn(monitor, "running", [
        { name: 'bash', args: { command: 'npm test' }, result: { stdout: 'ok' } },
      ])

      monitor.evaluate()
      feedTurn(monitor, "editing again", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      const result = monitor.evaluate()

      // last 3: [edit:auth, bash:test, edit:auth] — not identical
      expect(result.verdict).not.toBe('nudge')
    })

    it('does not fire when all 3 calls are read-only repetition', () => {
      for (let i = 0; i < 3; i++) {
        feedTurn(monitor, `reading ${i}`, [
          { name: 'grep', args: { pattern: 'login' }, result: { matches: [] } },
        ])
      }
      const result = monitor.evaluate()

      // grep not in WRITE_TOOL_NAMES, so recent keys are empty
      expect(result.verdict).not.toBe('nudge')
    })

    it('fires when repetition is across turn boundaries', () => {
      // Turn 1: 2 identical failing edits
      feedTurn(monitor, "editing 1", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      monitor.evaluate()

      // Turn 2: 1 more identical failing edit = 3 total
      feedTurn(monitor, "editing 2", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      const result = monitor.evaluate()

      expect(result.verdict).toBe('nudge')
      expect(result.reason).toBe('tool_repetition')
    })

    it('clears recentToolCallKeys after firing', () => {
      for (let i = 0; i < 3; i++) {
        feedTurn(monitor, `editing ${i}`, [
          { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
        ])
      }
      monitor.evaluate()

      // After nudge, keys are cleared. Next turn with new tool call should not re-trigger
      feedTurn(monitor, "running tests", [
        { name: 'bash', args: { command: 'npm test' }, result: { stdout: 'ok' } },
      ])
      const r2 = monitor.evaluate()
      expect(r2.verdict).not.toBe('nudge')
    })
  })

  describe('no_state_delta_turns', () => {
    it('increments when only read-only tools are used', () => {
      // 3 turns of read-only tools on NEW files each time (new file = delta)
      feedTurn(monitor, "exploring", [
        { name: 'grep', args: { pattern: 'login' }, result: { matches: [] } },
      ])
      monitor.evaluate()
      feedTurn(monitor, "reading more", [
        { name: 'read_file', args: { filePath: 'new_file.ts' }, result: { content: '...' } },
      ])
      monitor.evaluate()
      feedTurn(monitor, "checking status", [
        { name: 'git_status', args: {}, result: { branch: 'main' } },
      ])
      monitor.evaluate()

      // Turn 4: another read-only tool on old file → first no-delta turn
      feedTurn(monitor, "re-reading", [
        { name: 'read_file', args: { filePath: 'new_file.ts' }, result: { content: '...' } },
      ])
      const result = monitor.evaluate()

      // noDeltaTurns = 1, not >= 4, so continue
      expect(result.verdict).toBe('continue')
    })

    it('increments when reading the same file repeatedly', () => {
      // Turn 1: read auth.ts for first time → delta
      feedTurn(monitor, "reading auth.ts", [
        { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
      ])
      monitor.evaluate()

      // Turns 2–5: re-read auth.ts → no delta (4 turns without delta)
      for (let i = 0; i < 4; i++) {
        feedTurn(monitor, `re-reading auth.ts ${i}`, [
          { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
        ])
        monitor.evaluate()
      }

      // Turn 6: noDeltaTurns = 5 (still reading same file)
      feedTurn(monitor, "still reading auth.ts", [
        { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
      ])
      const result = monitor.evaluate()

      expect(result.verdict).toBe('nudge')
      expect(result.reason).toBe('no_state_delta')
    })

    it('resets when a write tool succeeds', () => {
      feedTurn(monitor, "reading", [
        { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
      ])
      monitor.evaluate()
      feedTurn(monitor, "reading more", [
        { name: 'grep', args: { pattern: 'login' }, result: { matches: [] } },
      ])
      monitor.evaluate()

      feedTurn(monitor, "editing", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      const result = monitor.evaluate()
      expect(result.verdict).toBe('continue')
    })

    it('resets when a new file is read', () => {
      feedTurn(monitor, "reading auth.ts", [
        { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
      ])

      monitor.evaluate()
      feedTurn(monitor, "re-reading auth.ts", [
        { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
      ])

      monitor.evaluate()
      feedTurn(monitor, "reading tests.ts", [
        { name: 'read_file', args: { filePath: 'tests.ts' }, result: { content: '...' } },
      ])

      const result = monitor.evaluate()
      expect(result.verdict).toBe('continue')
    })

    it('escalates nudge message at 6+ turns', () => {
      // 5 text-only turns (no progress): turns 1-4 trigger nudge, turn 5 pushes past
      for (let i = 0; i < 5; i++) {
        feedTextOnlyTurn(monitor, `thinking ${i}`)
        monitor.evaluate()
      }

      // Turn 6: noDeltaTurns = 6
      feedTextOnlyTurn(monitor, "thinking 5")
      const r6 = monitor.evaluate()
      expect(r6.verdict).toBe('nudge')
      expect(r6.nudgeText).toContain('stuck')
    })
  })

  describe('tool_error_streak', () => {
    it('fires when 3 consecutive tool errors occur', () => {
      for (let i = 0; i < 2; i++) {
        feedTurn(monitor, `trying ${i}`, [
          { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
        ])
        monitor.evaluate()
      }
      // 2 errors → errorStreak=2, noDeltaTurns=2

      feedTurn(monitor, "trying 2", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      const result = monitor.evaluate()

      expect(result.verdict).toBe('nudge')
      expect(result.reason).toBe('tool_error_streak')
    })

    it('does not fire when tools succeed between errors', () => {
      feedTurn(monitor, "trying 1", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      monitor.evaluate()
      feedTurn(monitor, "trying 2", [
        { name: 'bash', args: { command: 'npm test' }, result: { stdout: 'ok' } },
      ])
      monitor.evaluate()
      feedTurn(monitor, "trying 3", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])

      const result = monitor.evaluate()
      expect(result.verdict).not.toBe('nudge')
    })

    it('clears error streak after nudge fires', () => {
      // Trigger error streak nudge
      for (let i = 0; i < 3; i++) {
        feedTurn(monitor, `trying ${i}`, [
          { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
        ])
      }
      monitor.evaluate()

      // After nudge, error streak was cleared AND recentToolCallKeys was cleared
      // Next success should not re-trigger
      feedTurn(monitor, "fixed it", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      const r = monitor.evaluate()
      expect(r.verdict).not.toBe('nudge')
    })
  })

  describe('decision chain priority', () => {
    it('error streak overrides tool repetition', () => {
      for (let i = 0; i < 2; i++) {
        feedTurn(monitor, `trying ${i}`, [
          { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
        ])
        monitor.evaluate()
      }
      // After 2 turns: errorStreak=2, noDeltaTurns=2, recentToolCallKeys=[k,k]

      // Turn 3: error → errorStreak=3, recentToolCallKeys=[k,k,k]
      feedTurn(monitor, "trying 2", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'Failed' },
      ])
      const result = monitor.evaluate()

      // Both errorStreak (3) and repetition (3 keys) are true
      // Error streak should win (higher priority)
      expect(result.reason).toBe('tool_error_streak')
    })

    it('continue verdict when all signals are clean', () => {
      feedTurn(monitor, "editing auth.ts", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      const result = monitor.evaluate()
      expect(result.verdict).toBe('continue')
      expect(result.reason).toBe('ok')
    })
  })

  describe('resetForNewUserTurn', () => {
    it('clears all counters', () => {
      feedTextOnlyTurn(monitor, "Let me update auth.ts")
      monitor.evaluate()

      monitor.resetForNewUserTurn()

      feedTurn(monitor, "doing actual work", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      const result = monitor.evaluate()
      expect(result.verdict).toBe('continue')
    })

    it('preserves filesReadThisRun', () => {
      feedTurn(monitor, "reading auth", [
        { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
      ])
      monitor.evaluate()

      monitor.resetForNewUserTurn()

      feedTurn(monitor, "reading auth again", [
        { name: 'read_file', args: { filePath: 'auth.ts' }, result: { content: '...' } },
      ])
      const result = monitor.evaluate()

      // auth.ts already in filesReadThisRun → re-read doesn't count as delta
      expect(result.verdict).toBe('continue')
    })
  })

  describe('consumeNudge', () => {
    it('returns null when no nudge is pending', () => {
      expect(monitor.consumeNudge()).toBeNull()
    })

    it('returns pending nudge text and clears it', () => {
      feedTextOnlyTurn(monitor, "Let me update auth.ts")
      monitor.evaluate()

      const nudge = monitor.consumeNudge()
      expect(nudge).toContain('[watchdog]')
      expect(monitor.consumeNudge()).toBeNull()
    })
  })

  describe('config overrides', () => {
    it('respects custom maxToolErrorStreak', () => {
      const m = new HealthMonitor('sess_test', { maxToolErrorStreak: 2 }, tmpLog)
      feedTurn(m, "trying", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'fail' },
      ])
      m.evaluate()
      feedTurn(m, "trying", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'fail' },
      ])
      const r = m.evaluate()
      expect(r.verdict).toBe('nudge')
      expect(r.reason).toBe('tool_error_streak')
    })

    it('respects custom noDeltaNudgeAt', () => {
      const m = new HealthMonitor('sess_test', { noDeltaNudgeAt: 2 }, tmpLog)
      feedTextOnlyTurn(m, "thinking...")
      m.evaluate()
      feedTextOnlyTurn(m, "thinking...")
      const r = m.evaluate()
      expect(r.verdict).toBe('nudge')
      expect(r.reason).toBe('no_state_delta')
    })

    it('respects custom toolRepetitionCount', () => {
      const m = new HealthMonitor('sess_test', { toolRepetitionCount: 2 }, tmpLog)
      feedTurn(m, "trying 1", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'fail' },
      ])
      m.evaluate()
      feedTurn(m, "trying 2", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, error: 'fail' },
      ])
      const r = m.evaluate()
      // 2 identical + noDelta >= 2 (both failed) → fires with custom count=2
      expect(r.verdict).toBe('nudge')
      expect(r.reason).toBe('tool_repetition')
    })
  })

  describe('logging', () => {
    it('writes nudge verdicts to the log file', () => {
      feedTextOnlyTurn(monitor, "Let me update auth.ts")
      monitor.evaluate()

      const content = fs.readFileSync(tmpLog, 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(1)

      const entry = JSON.parse(lines[0])
      expect(entry.verdict).toBe('nudge')
      expect(entry.sessionId).toBe('sess_test')
      expect(entry.reason).toBe('intent_without_action')
    })

    it('does not create the log file for continue verdicts', () => {
      feedTurn(monitor, "working", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      monitor.evaluate()

      expect(fs.existsSync(tmpLog)).toBe(false)
    })

    it('survives write errors', () => {
      const m = new HealthMonitor('sess_test', undefined, '/nonexistent/deep/log.jsonl')
      feedTextOnlyTurn(m, "Let me update auth.ts")
      expect(() => m.evaluate()).not.toThrow()
    })
  })

  describe('multi-turn scenarios', () => {
    it('tracks turn count correctly', () => {
      expect(monitor.getTurnCount()).toBe(0)

      feedTextOnlyTurn(monitor, "hello")
      monitor.evaluate()
      expect(monitor.getTurnCount()).toBe(1)

      feedTextOnlyTurn(monitor, "world")
      monitor.evaluate()
      expect(monitor.getTurnCount()).toBe(2)
    })

    it('intent fires independently across turns', () => {
      feedTextOnlyTurn(monitor, "Let me edit auth.ts")
      const r1 = monitor.evaluate()
      expect(r1.reason).toBe('intent_without_action')

      // Second turn with actual work
      feedTurn(monitor, "editing now", [
        { name: 'edit_file', args: { filePath: 'auth.ts' }, result: { ok: true } },
      ])
      const r2 = monitor.evaluate()
      expect(r2.verdict).toBe('continue')
    })
  })
})
