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

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

function buildPodmanArgs(image: string, workspaceRoot: string, command: string): string[] {
  return [
    'run',
    '--rm',
    '-v', `${workspaceRoot}:/work:Z`,
    '-w', '/work',
    image,
    'sh', '-c', command,
  ]
}

export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut?: boolean
}

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

  const podmanCmd = `podman ${buildPodmanArgs(options.image, options.workspaceRoot, command).map(a => shellEscape(a)).join(' ')}`

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

  const args = buildPodmanArgs(options.image, options.workspaceRoot, command)

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
