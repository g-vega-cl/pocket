import fs from 'node:fs'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Event } from '@pocket/core'

export class EventLog {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.baseDir, sessionId)
  }

  private eventsPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'events.jsonl')
  }

  append(sessionId: string, event: Event): void {
    const dir = this.sessionDir(sessionId)
    fs.mkdirSync(dir, { recursive: true })

    const filePath = this.eventsPath(sessionId)
    const line = JSON.stringify(event) + '\n'
    const fd = fs.openSync(filePath, 'a')
    try {
      fs.writeSync(fd, line)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }

  async *replay(sessionId: string, afterSeq: number): AsyncGenerator<Event> {
    const filePath = this.eventsPath(sessionId)
    if (!fs.existsSync(filePath)) return

    const stream = createReadStream(filePath, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    try {
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as Event
          if (event.seq > afterSeq) {
            yield event
          }
        } catch {
          // skip malformed lines
        }
      }
    } finally {
      rl.close()
      stream.destroy()
    }
  }

  replaySync(sessionId: string): Event[] {
    const filePath = this.eventsPath(sessionId)
    if (!fs.existsSync(filePath)) return []

    const content = fs.readFileSync(filePath, 'utf-8')
    const events: Event[] = []
    for (const line of content.trim().split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as Event)
      } catch {
        // skip malformed lines
      }
    }
    return events
  }
}
