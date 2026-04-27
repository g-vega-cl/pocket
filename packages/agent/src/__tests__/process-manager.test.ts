import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProcessManager } from '../process-manager.js'

describe('ProcessManager', () => {
  let pm: ProcessManager

  beforeEach(() => {
    pm = new ProcessManager(8, 4 * 1024 * 1024)
  })

  afterEach(() => {
    pm.killAll()
  })

  it('should spawn a background process', async () => {
    const proc = await pm.spawn('sleep 0.1', '/tmp')
    expect(proc.id).toBeTruthy()
    expect(proc.id).toMatch(/^proc_/)
    expect(proc.command).toBe('sleep 0.1')
    // Process should still be running since we check immediately after spawn
    const p = pm.getProcess(proc.id)
    expect(p?.status).toBe('running')
  })

  it('should track output', async () => {
    const proc = await pm.spawn('echo "line1\nline2"', '/tmp')
    // Wait a bit for process to finish
    await new Promise(r => setTimeout(r, 100))

    const output = pm.readOutput(proc.id, 'since_last_read')
    expect(output.stdout).toContain('line1')
    expect(output.stdout).toContain('line2')
  })

  it('should detect process exit', async () => {
    const proc = await pm.spawn('echo done', '/tmp')
    await new Promise(r => setTimeout(r, 100))

    const p = pm.getProcess(proc.id)
    expect(p?.status).toBe('exited')
  })

  it('should kill a process', async () => {
    const proc = await pm.spawn('sleep 10', '/tmp')
    pm.kill(proc.id)
    await new Promise(r => setTimeout(r, 100))

    const p = pm.getProcess(proc.id)
    expect(p?.status).toBe('killed')
  })

  it('should list all processes', async () => {
    await pm.spawn('sleep 10', '/tmp')
    await pm.spawn('sleep 10', '/tmp')
    expect(pm.listProcesses()).toHaveLength(2)
  })

  it('should enforce max processes', async () => {
    const smallPM = new ProcessManager(2, 1024)
    await smallPM.spawn('sleep 10', '/tmp')
    await smallPM.spawn('sleep 10', '/tmp')
    expect(smallPM.isFull()).toBe(true)

    smallPM.killAll()
  })

  it('should kill all on shutdown', async () => {
    await pm.spawn('sleep 10', '/tmp')
    await pm.spawn('sleep 10', '/tmp')
    pm.killAll()
    // Check all processes are killed
    for (const p of pm.listProcesses()) {
      expect(p.status).toBe('killed')
    }
  })
})
