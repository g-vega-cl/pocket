import { execSync, exec, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

let podmanAvailable: boolean | null = null

export function isPodmanAvailable(): boolean {
  if (podmanAvailable !== null) return podmanAvailable

  try {
    const stdout = execSync('command -v podman', { encoding: 'utf-8', timeout: 5000 })
    podmanAvailable = stdout.trim().length > 0
  } catch {
    podmanAvailable = false
  }

  return podmanAvailable
}

export function normalizeImage(image: string): string {
  const firstSlash = image.indexOf('/')
  if (firstSlash === -1) {
    return `docker.io/${image}`
  }
  const firstSegment = image.slice(0, firstSlash)
  if (firstSegment.includes('.') || firstSegment.includes(':')) {
    return image
  }
  return `docker.io/${image}`
}

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

// ─── Persistent container management ─────────────────────────

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

interface ContainerRecord {
  name: string
  image: string
  sessionId: string
  workspaceRoot: string
  startedAt: number
  lastActivity: number
  idleTimer?: ReturnType<typeof setTimeout>
}

const activeContainers = new Map<string, ContainerRecord>()

function containerName(sessionId: string): string {
  return `pocket-${sessionId}`
}

export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut?: boolean
}

export type SandboxProgressCallback = (message: string) => void

/** Ensure a persistent container exists for the given session. Starts one if needed. */
export async function ensureContainer(
  sessionId: string,
  image: string,
  workspaceRoot: string,
  onProgress?: SandboxProgressCallback,
): Promise<string> {
  if (!isPodmanAvailable()) {
    throw new Error('Podman is not available. Install podman or disable sandbox in config.')
  }

  image = normalizeImage(image)

  const name = containerName(sessionId)
  const existing = activeContainers.get(sessionId)

  // Check if container is still alive
  if (existing) {
    try {
      execSync(`podman inspect ${shellEscape(name)} --format '{{.State.Status}}'`, { timeout: 5000 })
      resetIdleTimer(sessionId)
      return name
    } catch {
      // Container died or was removed — clean up record and re-create
      clearTimeout(existing.idleTimer)
      activeContainers.delete(sessionId)
    }
  }

  // Remove any leftover container with the same name (from a previous crash)
  try {
    execSync(`podman rm -f ${shellEscape(name)} 2>/dev/null`, { timeout: 5000 })
  } catch {
    // ignore — container didn't exist
  }

  const cmd = `podman run -d --name ${shellEscape(name)} -v ${shellEscape(workspaceRoot)}:/work:Z -w /work ${shellEscape(image)} sleep infinity`
  console.log(`[Pocket] ensureContainer: ${cmd}`)
  onProgress?.(`Pulling image ${image}...`)
  const startTs = Date.now()

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 })
    console.log(`[Pocket] podman run completed in ${Date.now() - startTs}ms`)

    // Log output for debugging - both stdout and stderr can contain useful info
    if (stdout) {
      console.log(`[Pocket] podman run stdout: ${stdout.slice(0, 500)}`)
    }
    if (stderr) {
      console.log(`[Pocket] podman run stderr: ${stderr.slice(0, 500)}`)
    }

    // Check if container actually started by inspecting it
    try {
      const inspectResult = execSync(`podman inspect ${shellEscape(name)} --format '{{.State.Status}}'`, { timeout: 5000 })
      console.log(`[Pocket] Container ${name} status: ${inspectResult}`)
      onProgress?.(`Container started successfully`)
    } catch (inspectErr) {
      console.error(`[Pocket] Container ${name} inspect failed:`, inspectErr)
      throw new Error(`Container ${name} failed to start. stderr: ${stderr || 'unknown'}`)
    }

    if (stderr && !stdout) {
      throw new Error(`Failed to start sandbox container: ${stderr.trim()}`)
    }
  } catch (err: any) {
    const errorMsg = err.message || err.stderr || err.stdout || String(err)
    console.error(`[Pocket] ensureContainer failed after ${Date.now() - startTs}ms:`, errorMsg)
    throw new Error(`Failed to start sandbox container: ${errorMsg}`)
  }

  const record: ContainerRecord = {
    name,
    image,
    sessionId,
    workspaceRoot,
    startedAt: Date.now(),
    lastActivity: Date.now(),
  }
  activeContainers.set(sessionId, record)
  resetIdleTimer(sessionId)

  return name
}

/** Execute a command inside a persistent container. */
export async function execInContainer(
  containerName: string,
  command: string,
  options?: { timeout?: number; maxBuffer?: number; onProgress?: (message: string) => void },
): Promise<SandboxResult> {
  if (!isPodmanAvailable()) {
    throw new Error('Podman is not available. Install podman or disable sandbox in config.')
  }

  // Derive sessionId from container name
  const prefix = 'pocket-'
  if (!containerName.startsWith(prefix)) {
    throw new Error(`Invalid container name: ${containerName}`)
  }
  const sessionId = containerName.slice(prefix.length)
  const record = activeContainers.get(sessionId)

  const timeout = options?.timeout ?? 300000
  const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024
  options?.onProgress?.(`[sandbox] exec: ${command}`)

  // Build the podman exec command — shell-escape the command to avoid injection
  const escapedCommand = shellEscape(command)
  const cmd = `podman exec ${shellEscape(containerName)} sh -c ${escapedCommand}`

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout, maxBuffer })

    if (record) {
      record.lastActivity = Date.now()
      resetIdleTimer(sessionId)
    }

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
    }
  } catch (error: any) {
    if (record) {
      record.lastActivity = Date.now()
      resetIdleTimer(sessionId)
    }

    if (error.killed) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || 'Command timed out',
        exitCode: error.code || 1,
        timedOut: true,
      }
    }

    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      exitCode: error.code || 1,
    }
  }
}

/** Stop and remove a persistent container for a session. */
export async function stopSandboxContainer(sessionId: string): Promise<void> {
  const record = activeContainers.get(sessionId)
  if (!record) return

  clearTimeout(record.idleTimer)
  activeContainers.delete(sessionId)

  const name = containerName(sessionId)
  try {
    await execAsync(`podman kill ${shellEscape(name)} 2>/dev/null && podman rm ${shellEscape(name)} 2>/dev/null`, { timeout: 10000 })
  } catch {
    // ignore — container may already be gone
  }
}

/** List all active containers (for debugging / status). */
export function listActiveContainers(): Array<{ sessionId: string; name: string; image: string; uptimeMs: number }> {
  const now = Date.now()
  return Array.from(activeContainers.entries()).map(([sessionId, record]) => ({
    sessionId,
    name: record.name,
    image: record.image,
    uptimeMs: now - record.startedAt,
  }))
}

function resetIdleTimer(sessionId: string): void {
  const record = activeContainers.get(sessionId)
  if (!record) return

  clearTimeout(record.idleTimer)
  record.idleTimer = setTimeout(async () => {
    try {
      await stopSandboxContainer(sessionId)
    } catch {
      // ignore on cleanup
    }
  }, IDLE_TIMEOUT_MS)

  // Allow the process to exit if it's the only thing holding the event loop
  if (record.idleTimer && typeof record.idleTimer === 'object' && 'unref' in record.idleTimer) {
    record.idleTimer.unref()
  }
}

/** Kill all active containers (for server shutdown). */
export async function killAllContainers(): Promise<void> {
  const ids = Array.from(activeContainers.keys())
  await Promise.allSettled(ids.map(id => stopSandboxContainer(id)))
}

// ─── Legacy ephemeral sandbox (kept for tests and background processes) ───

export interface SandboxOptions {
  image: string
  workspaceRoot: string
  timeout?: number
  maxBuffer?: number
  onProgress?: (message: string) => void
}

export async function runInSandbox(
  command: string,
  options: SandboxOptions,
): Promise<SandboxResult> {
  if (!isPodmanAvailable()) {
    throw new Error('Podman is not available. Install podman or disable sandbox in config.')
  }

  options.image = normalizeImage(options.image)

  const podmanArgs = [
    'run', '--rm',
    '-v', `${options.workspaceRoot}:/work:Z`,
    '-w', '/work',
    options.image,
    'sh', '-c', command,
  ]
  const podmanCmd = `podman ${podmanArgs.map(a => shellEscape(a)).join(' ')}`

  options.onProgress?.(`[sandbox] ${options.image}: ${command}`)

  try {
    const { stdout, stderr } = await execAsync(podmanCmd, {
      timeout: options.timeout ?? 300000,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    })

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
    }
  } catch (error: any) {
    if (error.killed) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || 'Command timed out',
        exitCode: error.code || 1,
        timedOut: true,
      }
    }
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      exitCode: error.code || 1,
    }
  }
}

export interface SandboxSpawnOptions {
  image: string
  workspaceRoot: string
  onStdout?: (data: string) => void
  onStderr?: (data: string) => void
}

export function spawnInSandbox(
  command: string,
  options: SandboxSpawnOptions,
): ChildProcess {
  if (!isPodmanAvailable()) {
    throw new Error('Podman is not available. Install podman or disable sandbox in config.')
  }

  options.image = normalizeImage(options.image)

  const args = [
    'run', '--rm',
    '-v', `${options.workspaceRoot}:/work:Z`,
    '-w', '/work',
    options.image,
    'sh', '-c', command,
  ]

  const proc = spawn('podman', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  proc.stdout?.on('data', (data: Buffer) => {
    options.onStdout?.(data.toString())
  })

  proc.stderr?.on('data', (data: Buffer) => {
    options.onStderr?.(data.toString())
  })

  return proc
}