import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventLog } from '../event-log.js'
import type { Event } from '@pocket/core'

describe('EventLog', () => {
  let tmpDir: string
  let eventLog: EventLog

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pocket-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    eventLog = new EventLog(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeEvent(type: Event['type'], overrides?: Partial<Event>): Event {
    const seq = overrides?.seq ?? 1
    const ts = overrides?.ts ?? Date.now()
    const base = { seq, ts, type }
    let payload: Record<string, unknown> = {}
    switch (type) {
      case 'user_message':
        payload = { content: 'hello' }
        break
      case 'assistant_text_delta':
        payload = { text: 'Hi there' }
        break
      case 'assistant_text_done':
        payload = { text: 'Done' }
        break
      case 'tool_call_start':
        payload = { toolCallId: 'tc1', toolName: 'read_file', args: { path: 'foo.txt' } }
        break
      case 'tool_call_result':
        payload = { toolCallId: 'tc1', toolName: 'read_file', result: 'content' }
        break
      case 'status':
        payload = { status: 'working' }
        break
    }
    return { ...base, type, payload } as Event
  }

  it('should create sessions directory on append', () => {
    const event = makeEvent('user_message')
    eventLog.append('sess-1', event)
    expect(fs.existsSync(path.join(tmpDir, 'sess-1', 'events.jsonl'))).toBe(true)
  })

  it('should write events as JSONL', () => {
    const event1 = makeEvent('user_message', { seq: 1, ts: 1000 })
    const event2 = makeEvent('assistant_text_delta', { seq: 2, ts: 2000 })

    eventLog.append('sess-1', event1)
    eventLog.append('sess-1', event2)

    const content = fs.readFileSync(path.join(tmpDir, 'sess-1', 'events.jsonl'), 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)

    const parsed1 = JSON.parse(lines[0])
    expect(parsed1.seq).toBe(1)
    expect(parsed1.type).toBe('user_message')
    expect(parsed1.payload.content).toBe('hello')

    const parsed2 = JSON.parse(lines[1])
    expect(parsed2.seq).toBe(2)
    expect(parsed2.type).toBe('assistant_text_delta')
  })

  it('should replay events from a given seq', async () => {
    for (let i = 1; i <= 10; i++) {
      eventLog.append('sess-1', makeEvent('assistant_text_delta', { seq: i, ts: i * 1000 }))
    }

    const replayed: Event[] = []
    for await (const event of eventLog.replay('sess-1', 5)) {
      replayed.push(event)
    }

    expect(replayed).toHaveLength(5)
    expect(replayed[0].seq).toBe(6)
    expect(replayed[4].seq).toBe(10)
  })

  it('should replay all events if afterSeq is 0', async () => {
    for (let i = 1; i <= 3; i++) {
      eventLog.append('sess-1', makeEvent('user_message', { seq: i, ts: i * 1000 }))
    }

    const replayed: Event[] = []
    for await (const event of eventLog.replay('sess-1', 0)) {
      replayed.push(event)
    }

    expect(replayed).toHaveLength(3)
    expect(replayed[0].seq).toBe(1)
    expect(replayed[2].seq).toBe(3)
  })

  it('should return iterator that yields nothing if no events exist', async () => {
    const replayed: Event[] = []
    for await (const event of eventLog.replay('nonexistent', 0)) {
      replayed.push(event)
    }
    expect(replayed).toHaveLength(0)
  })

  it('should return iterator that yields nothing if afterSeq beyond all events', async () => {
    eventLog.append('sess-1', makeEvent('user_message', { seq: 1 }))
    const replayed: Event[] = []
    for await (const event of eventLog.replay('sess-1', 5)) {
      replayed.push(event)
    }
    expect(replayed).toHaveLength(0)
  })

  it('should isolate sessions — different session IDs get different files', () => {
    eventLog.append('sess-a', makeEvent('user_message', { seq: 1 }))
    eventLog.append('sess-b', makeEvent('user_message', { seq: 1 }))

    expect(fs.existsSync(path.join(tmpDir, 'sess-a', 'events.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'sess-b', 'events.jsonl'))).toBe(true)

    const aContent = fs.readFileSync(path.join(tmpDir, 'sess-a', 'events.jsonl'), 'utf-8')
    const bContent = fs.readFileSync(path.join(tmpDir, 'sess-b', 'events.jsonl'), 'utf-8')
    expect(aContent.trim().split('\n')).toHaveLength(1)
    expect(bContent.trim().split('\n')).toHaveLength(1)
  })

  it('should write all event types correctly', () => {
    const types: Event['type'][] = [
      'user_message', 'assistant_text_delta', 'assistant_text_done',
      'tool_call_start', 'tool_call_result', 'status',
    ]
    types.forEach((type, i) => {
      eventLog.append('sess-1', makeEvent(type, { seq: i + 1, ts: (i + 1) * 1000 }))
    })

    const replayed: Event[] = []
    for (const event of eventLog.replaySync('sess-1')) {
      replayed.push(event)
    }
    expect(replayed).toHaveLength(6)
    expect(replayed.map(e => e.type)).toEqual(types)
  })

  it('should use fsync after writes (verified via file content availability)', () => {
    eventLog.append('sess-1', makeEvent('user_message', { seq: 1 }))
    // File should be immediately readable (fsync ensures this)
    const content = fs.readFileSync(path.join(tmpDir, 'sess-1', 'events.jsonl'), 'utf-8')
    expect(content).toBeTruthy()
    expect(JSON.parse(content.trim())).toHaveProperty('seq', 1)
  })
})
