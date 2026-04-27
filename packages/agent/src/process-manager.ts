import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { RingBuffer } from './ring-buffer.js'
import type { BackgroundProcess, BashReadResult } from '@pocket/core'

export class ProcessManager {
  private processes: Map<string, {
    info: BackgroundProcess
    proc: ChildProcess
    stdoutBuf: RingBuffer
    stderrBuf: RingBuffer
  }> = new Map()

  private maxProcesses: number
  private bufferSize: number
  private idCounter = 0

  constructor(maxProcesses: number, bufferSize: number) {
    this.maxProcesses = maxProcesses
    this.bufferSize = bufferSize
  }

  isFull(): boolean {
    return this.processes.size >= this.maxProcesses
  }

  spawn(command: string, cwd: string): Promise<BackgroundProcess> {
    return new Promise((resolve, reject) => {
      if (this.isFull()) {
        reject(new Error(`Maximum background processes (${this.maxProcesses}) reached`))
        return
      }

      const id = `proc_${Date.now().toString(36)}_${++this.idCounter}`
      const proc = spawn('sh', ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      })

      const stdoutBuf = new RingBuffer(this.bufferSize)
      const stderrBuf = new RingBuffer(this.bufferSize)

      const info: BackgroundProcess = {
        id,
        pid: proc.pid ?? null,
        command,
        startedAt: Date.now(),
        status: 'running',
        exitCode: null,
        cwd,
      }

      proc.stdout?.on('data', (data: Buffer) => {
        stdoutBuf.write(data.toString())
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderrBuf.write(data.toString())
      })

      proc.on('exit', (code, signal) => {
        if (signal) {
          info.status = 'killed'
        } else {
          info.status = 'exited'
          info.exitCode = code
        }
        info.pid = null
      })

      proc.on('error', () => {
        info.status = 'exited'
        info.exitCode = -1
        info.pid = null
      })

      this.processes.set(id, { info, proc, stdoutBuf, stderrBuf })

      // Resolve after a short delay to let the process start
      setTimeout(() => resolve(info), 10)
    })
  }

  getProcess(id: string): BackgroundProcess | null {
    return this.processes.get(id)?.info ?? null
  }

  readOutput(id: string, mode: 'since_last_read' | 'tail' | 'all', lines?: number): BashReadResult {
    const entry = this.processes.get(id)
    if (!entry) {
      return { stdout: '', stderr: '', isRunning: false, droppedLines: 0 }
    }

    let stdout: string
    let stderr: string

    switch (mode) {
      case 'since_last_read':
        stdout = entry.stdoutBuf.read()
        stderr = entry.stderrBuf.read()
        break
      case 'tail':
        stdout = lines ? entry.stdoutBuf.readTail(lines) : entry.stdoutBuf.readAll()
        stderr = lines ? entry.stderrBuf.readTail(lines) : entry.stderrBuf.readAll()
        break
      case 'all':
        stdout = entry.stdoutBuf.readAll()
        stderr = entry.stderrBuf.readAll()
        break
    }

    return {
      stdout,
      stderr,
      isRunning: entry.info.status === 'running',
      droppedLines: entry.stdoutBuf.getDroppedLines() + entry.stderrBuf.getDroppedLines(),
    }
  }

  sendInput(id: string, input: string): boolean {
    const entry = this.processes.get(id)
    if (!entry || entry.info.status !== 'running') return false

    entry.proc.stdin?.write(input)
    return true
  }

  kill(id: string): boolean {
    const entry = this.processes.get(id)
    if (!entry) return false

    entry.proc.kill('SIGTERM')

    // Force kill after 5 seconds if still alive
    setTimeout(() => {
      if (entry.info.status === 'running') {
        try {
          entry.proc.kill('SIGKILL')
        } catch {
          // already dead
        }
      }
    }, 5000)

    entry.info.status = 'killed'
    return true
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id)
    }
  }

  listProcesses(): Array<{
    id: string
    command: string
    status: string
    startedAt: number
    exitCode: number | null
    hasUnreadOutput: boolean
  }> {
    return Array.from(this.processes.values()).map(({ info, stdoutBuf, stderrBuf }) => ({
      id: info.id,
      command: info.command,
      status: info.status,
      startedAt: info.startedAt,
      exitCode: info.exitCode,
      hasUnreadOutput: stdoutBuf.readAll().length > 0 || stderrBuf.readAll().length > 0,
    }))
  }

  cleanup(): void {
    this.killAll()
    this.processes.clear()
  }
}
