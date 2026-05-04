import fs from 'node:fs'
import path from 'node:path'
import type { SessionMeta, SessionStatus, PocketConfig, PermissionLevel, WatchdogConfig } from '@pocket/core'
import { DEFAULT_PROTECTED_BRANCHES, DEFAULT_SANDBOX_IMAGE, DEFAULT_BASH_DENY, DEFAULT_WATCHDOG_CONFIG } from '@pocket/core'
import type { EventLog } from './event-log.js'
import type { AgentRunner } from './agent-runner.js'
import type { PermissionGate } from './permission-gate.js'

interface CreateSessionInput {
  repoUrl: string
  task: string
  model: string
  isLocal?: boolean
  githubToken?: string
  sandboxImage?: string
}

const CONFIG_PATH = '.pocket/config.json'

export class SessionManager {
  private sessions: Map<string, SessionMeta> = new Map()
  private runners: Map<string, AgentRunner> = new Map()
  private baseDir: string
  private eventLog: EventLog
  private permissionGate?: PermissionGate

  constructor(baseDir: string, eventLog: EventLog, permissionGate?: PermissionGate) {
    this.baseDir = baseDir
    this.eventLog = eventLog
    this.permissionGate = permissionGate
    this.scanSessions()
  }

  private sessionsDir(): string {
    return this.baseDir
  }

  private sessionDir(id: string): string {
    return path.join(this.sessionsDir(), id)
  }

  private metaPath(id: string): string {
    return path.join(this.sessionDir(id), 'meta.json')
  }

  private permissionsPath(id: string): string {
    return path.join(this.sessionDir(id), 'permissions.json')
  }

  createSession(input: CreateSessionInput): SessionMeta {
    const id = 'sess_' + Math.random().toString(36).substring(2, 15)
    const now = Date.now()

    const config = this.getConfig()

    const sandboxImage = input.sandboxImage && typeof input.sandboxImage === 'string' && input.sandboxImage.trim()
      ? input.sandboxImage
      : config.defaultSandboxImage

    const meta: SessionMeta = {
      id,
      repoUrl: input.repoUrl,
      task: input.task,
      model: input.model,
      branchName: null,
      localPath: null,
      status: 'creating',
      createdAt: now,
      lastActivity: now,
      nextSeq: 1,
      isLocal: input.isLocal ?? false,
      githubToken: input.githubToken,
      sandboxImage,
    }

    this.sessions.set(id, meta)
    this.saveMeta(meta)
    return { ...meta }
  }

  getSession(id: string): SessionMeta | null {
    return this.sessions.get(id) ?? null
  }

  listSessions(): SessionMeta[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(s => ({ ...s }))
  }

  updateSession(id: string, updates: Partial<Pick<SessionMeta, 'status' | 'branchName' | 'localPath' | 'nextSeq' | 'lastActivity' | 'githubToken'>>): SessionMeta | null {
    const session = this.sessions.get(id)
    if (!session) return null

    Object.assign(session, updates, { lastActivity: Date.now() })
    this.saveMeta(session)
    return { ...session }
  }

  deleteSession(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false

    // Stop the runner if active
    const runner = this.runners.get(id)
    if (runner) {
      runner.abort()
      this.runners.delete(id)
    }

    // Clean up sandbox container
    if (session.sandboxImage) {
      import('@pocket/tools').then(({ stopSandboxContainer }) => {
        stopSandboxContainer(id).catch(() => {})
      })
    }

    this.sessions.delete(id)
    this.permissionGate?.clearSessionRules(id)

    // Remove session directory
    const dir = this.sessionDir(id)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    return true
  }

  persistPermissionRule(sessionId: string, toolName: string, level: PermissionLevel): void {
    this.permissionGate?.setSessionRule(sessionId, toolName, level)
    this.savePermissions(sessionId)
  }

  private savePermissions(sessionId: string): void {
    const rules = this.permissionGate?.getSessionRules(sessionId)
    if (!rules || Object.keys(rules).length === 0) {
      // Remove file if no rules
      const p = this.permissionsPath(sessionId)
      if (fs.existsSync(p)) {
        fs.unlinkSync(p)
      }
      return
    }
    fs.writeFileSync(this.permissionsPath(sessionId), JSON.stringify(rules, null, 2))
  }

  getRunner(id: string): AgentRunner | null {
    return this.runners.get(id) ?? null
  }

  setRunner(id: string, runner: AgentRunner): void {
    this.runners.set(id, runner)
  }

  removeRunner(id: string): void {
    this.runners.delete(id)
  }

  getEventLog(): EventLog {
    return this.eventLog
  }

  getConfig(): PocketConfig {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~'
    const configPath = path.join(homeDir, CONFIG_PATH)
    let config: Partial<PocketConfig> = {}
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      }
    } catch {
      // use defaults
    }
    const defaultSandboxImage = config.defaultSandboxImage && typeof config.defaultSandboxImage === 'string' && config.defaultSandboxImage.trim()
      ? config.defaultSandboxImage
      : DEFAULT_SANDBOX_IMAGE

    const watchdogConfig = {
      ...DEFAULT_WATCHDOG_CONFIG,
      ...config.watchdog,
    }

    return {
      bashAllow: config.bashAllow ?? [],
      bashDeny: config.bashDeny ?? DEFAULT_BASH_DENY,
      protectedBranches: config.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
      processBufferSize: config.processBufferSize ?? 4 * 1024 * 1024,
      maxBackgroundProcesses: config.maxBackgroundProcesses ?? 8,
      defaultSandboxImage,
      watchdog: watchdogConfig,
    }
  }

  private saveMeta(meta: SessionMeta): void {
    const dir = this.sessionDir(meta.id)
    fs.mkdirSync(dir, { recursive: true })

    const { githubToken, ...safeMeta } = meta
    void githubToken // explicitly not persisted

    fs.writeFileSync(this.metaPath(meta.id), JSON.stringify(safeMeta, null, 2))
  }

  private scanSessions(): void {
    const sessionsDir = this.sessionsDir()
    if (!fs.existsSync(sessionsDir)) return

    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const metaFile = path.join(this.sessionsDir(), entry.name, 'meta.json')
      if (!fs.existsSync(metaFile)) continue

      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as SessionMeta

        // Crash recovery: mark 'working' sessions as 'interrupted'
        if (meta.status === 'working') {
          meta.status = 'interrupted'
          this.saveMeta(meta)

          // Append a status event explaining the crash
          this.eventLog.append(meta.id, {
            seq: meta.nextSeq,
            ts: Date.now(),
            type: 'status',
            payload: { status: 'interrupted', message: 'Server restarted while session was active. Review progress before resuming.' },
          } as any)
          meta.nextSeq++
          this.saveMeta(meta)
        }

        this.sessions.set(meta.id, meta)

        // Load persisted permission rules
        if (this.permissionGate) {
          const permFile = this.permissionsPath(meta.id)
          if (fs.existsSync(permFile)) {
            try {
              const rules = JSON.parse(fs.readFileSync(permFile, 'utf-8')) as Record<string, PermissionLevel>
              for (const [toolName, level] of Object.entries(rules)) {
                this.permissionGate.setSessionRule(meta.id, toolName, level)
              }
            } catch {
              // skip corrupted permissions file
            }
          }
        }
      } catch {
        // skip corrupted sessions
      }
    }
  }
}
