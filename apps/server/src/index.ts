import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '..', '..', '..', '.env') })

import { SessionManager, EventLog, ToolRegistry, AgentRunner, ProcessManager, PermissionGate } from '@pocket/agent'
import { OpenRouterProvider } from '@pocket/llm'
import {
  readFileTool, listFilesTool, writeFileTool, editFileTool,
  bashTool, grepTool, globTool, webFetchTool, webSearchTool,
  planTool, todosWriteTool,
  gitStatusTool, gitLogTool, gitDiffTool,
  gitCreateBranchTool, gitCommitTool, gitPushTool,
  githubCreatePRTool,
  bootstrapRepoTool,
  createBackgroundTools,
  getWorkspaceDir,
  cloneRepo,
  initLocalRepo,
  isPodmanAvailable,
  killAllContainers,
  stopSandboxContainer,
  ensureContainer,
} from '@pocket/tools'
import type { Event, PocketConfig } from '@pocket/core'
import { DEFAULT_PROTECTED_BRANCHES, DEFAULT_SANDBOX_IMAGE, DEFAULT_BASH_DENY } from '@pocket/core'

function getConfig(): PocketConfig {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~'
  const configPath = path.join(homeDir, '.pocket', 'config.json')
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

  return {
    bashAllow: config.bashAllow ?? [],
    bashDeny: config.bashDeny ?? DEFAULT_BASH_DENY,
    protectedBranches: config.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
    processBufferSize: config.processBufferSize ?? 4 * 1024 * 1024,
    maxBackgroundProcesses: config.maxBackgroundProcesses ?? 8,
    defaultSandboxImage,
  }
}

interface BuildOptions {
  sessionsDir: string
  env?: Record<string, string | undefined>
}

export async function buildApp(options: BuildOptions) {
  const app = Fastify({ logger: false })

  await app.register(cors, { origin: true })

  const eventLog = new EventLog(options.sessionsDir)
  const config = getConfig()
  const permissionGate = new PermissionGate({
    bashAllow: config.bashAllow,
    bashDeny: config.bashDeny,
    protectedBranches: config.protectedBranches,
  })
  const sessionManager = new SessionManager(options.sessionsDir, eventLog, permissionGate)

  // Event emitters per session for SSE
  const eventEmitters = new Map<string, Set<(event: Event) => void>>()

  function subscribe(sessionId: string, callback: (event: Event) => void): () => void {
    if (!eventEmitters.has(sessionId)) {
      eventEmitters.set(sessionId, new Set())
    }
    const listeners = eventEmitters.get(sessionId)!
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
      if (listeners.size === 0) {
        eventEmitters.delete(sessionId)
      }
    }
  }

  function emitToSession(sessionId: string, event: Event): void {
    const listeners = eventEmitters.get(sessionId)
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(event)
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() }
  })

  // List GitHub repos
  app.get('/api/github/repos', async (request, reply) => {
    const githubToken = options.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN
    if (!githubToken) {
      return reply.status(400).send({ error: 'GITHUB_TOKEN not configured' })
    }

    try {
      const res = await fetch('https://api.github.com/user/repos?sort=pushed&per_page=5&direction=desc', {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'pocket',
        },
      })

      if (!res.ok) {
        const body = await res.text()
        return reply.status(res.status).send({ error: `GitHub API error: ${body}` })
      }

      const repos = await res.json() as Array<{
        full_name: string
        clone_url: string
        description: string | null
        pushed_at: string
        stargazers_count: number
        language: string | null
      }>

      return {
        repos: repos.map(r => ({
          fullName: r.full_name,
          cloneUrl: r.clone_url,
          description: r.description ?? '',
          pushedAt: r.pushed_at,
          stars: r.stargazers_count,
          language: r.language,
        })),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: `Failed to fetch repos: ${message}` })
    }
  })

  // Track ongoing workspace setups and bootstrap results
  const workspaceSetupPromises = new Map<string, Promise<void>>()
  const bootstrapResults = new Map<string, any>()

  // Create session — kicks off workspace setup immediately
  app.post('/api/sessions', async (request, reply) => {
    const body = request.body as any
    if (!body.repoUrl || !body.task || !body.model) {
      return reply.status(400).send({ error: 'repoUrl, task, and model are required' })
    }

    const sandboxImage = body.sandboxImage && typeof body.sandboxImage === 'string' && body.sandboxImage.trim()
      ? body.sandboxImage
      : undefined

    const session = sessionManager.createSession({
      repoUrl: body.repoUrl,
      task: body.task,
      model: body.model,
      githubToken: body.githubToken || (options.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN),
      isLocal: body.isLocal ?? false,
      sandboxImage,
    })

    const resp = {
      id: session.id,
      repoUrl: session.repoUrl,
      task: session.task,
      model: session.model,
      status: session.status,
      createdAt: session.createdAt,
      sandboxImage: session.sandboxImage,
    }

    // Kick off workspace setup asynchronously — progress is streamed via SSE
    const setupPromise = runWorkspaceSetup(
      session,
      sessionManager,
      eventLog,
      emitToSession,
      bootstrapResults,
    )
    workspaceSetupPromises.set(session.id, setupPromise)
    setupPromise.finally(() => {
      workspaceSetupPromises.delete(session.id)
    })

    return resp
  })

  // List sessions
  app.get('/api/sessions', async () => {
    const sessions = sessionManager.listSessions().map(s => ({
      id: s.id,
      repoUrl: s.repoUrl,
      task: s.task,
      model: s.model,
      branchName: s.branchName,
      status: s.status,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      sandboxImage: s.sandboxImage,
    }))
    return { sessions }
  })

  // Get session by ID
  app.get('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = sessionManager.getSession(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    const { githubToken, ...safe } = session
    void githubToken
    return safe
  })

  // Delete session
  app.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const success = sessionManager.deleteSession(id)
    if (!success) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    return { ok: true }
  })

  // SSE events stream
  app.get('/api/sessions/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = sessionManager.getSession(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    const lastEventId = request.headers['last-event-id']
    const afterSeq = lastEventId ? parseInt(String(lastEventId), 10) : 0

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Replay past events
    const replayStream = eventLog.replay(id, afterSeq)
    for await (const event of replayStream) {
      const data = JSON.stringify(event)
      reply.raw.write(`id: ${event.seq}\ndata: ${data}\n\n`)
    }

    // Subscribe to live events
    const unsubscribe = subscribe(id, (event) => {
      const data = JSON.stringify(event)
      reply.raw.write(`id: ${event.seq}\ndata: ${data}\n\n`)
    })

    // Heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 15000)

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })

    // Never finish — keep connection alive
    await new Promise(() => {})
  })

  // Send chat message
  app.post('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { content } = request.body as { content: string }

    const session = sessionManager.getSession(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    if (!content) {
      return reply.status(400).send({ error: 'content is required' })
    }

    // ─── Workspace setup: wait for the async setup kicked off at session creation ───
    const setupPromise = workspaceSetupPromises.get(id)
    if (!session.localPath && setupPromise) {
      try {
        await setupPromise
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({ error: `Workspace setup failed: ${message}` })
      }
    }

    // Refresh session after setup completes
    const updatedSession = sessionManager.getSession(id)
    if (!updatedSession) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    const workspaceRoot = updatedSession.localPath
    if (!workspaceRoot) {
      return reply.status(500).send({ error: 'Workspace setup did not produce a local path' })
    }
    // Use the bootstrap result computed during workspace setup
    const bootstrapResult = bootstrapResults.get(id) ?? null

    // Create the LLM provider
    const apiKey = options.env?.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return reply.status(500).send({ error: 'OPENROUTER_API_KEY not configured' })
    }

    const provider = new OpenRouterProvider({ apiKey })

    const registry = new ToolRegistry()
    registry.registerAll([
      readFileTool, listFilesTool, grepTool, globTool,
      webFetchTool, webSearchTool,
      gitStatusTool, gitLogTool, gitDiffTool,
      writeFileTool, editFileTool, bashTool,
      gitCreateBranchTool, gitCommitTool, gitPushTool,
      githubCreatePRTool,
      planTool, todosWriteTool,
    ])

    // Register background process tools
    const processManager = new ProcessManager(8, 4 * 1024 * 1024)
    const bgTools = createBackgroundTools(() => processManager)
    registry.registerAll([
      bgTools.bashBackgroundTool as any,
      bgTools.bashReadOutputTool as any,
      bgTools.bashSendInputTool as any,
      bgTools.bashKillTool as any,
      bgTools.listProcessesTool as any,
    ])

    // Build system prompt
    let bootstrapInfo = ''
    if (bootstrapResult) {
      const { detected, scripts, configFiles, ports, install, warnings } = bootstrapResult
      const detectedStr = detected.projectType !== 'unknown'
        ? `Project Type: ${detected.projectType} (${detected.packageManager || 'unknown package manager'})`
        : 'Project Type: unknown'
      const scriptsList = Object.keys(scripts).length > 0
        ? `Available Scripts: ${Object.entries(scripts).map(([k, v]) => `${k}="${v}"`).join(', ')}`
        : 'Scripts: none detected'
      const configList = Object.entries(configFiles).filter(([_, v]) => v).map(([k]) => k.replace('has', '')).join(', ')
      const configStr = configList ? `Detected Config: ${configList}` : ''
      const portsStr = `Dev Server Port: ${ports.dev} (suggested: ${ports.suggested.join(', ')})`
      const installStr = install.success ? 'Dependencies: installed successfully' : `Dependencies: install failed (${install.output.slice(0, 100)}...)`
      const warnStr = warnings.length > 0 ? `Warnings: ${warnings.join('; ')}` : ''

      bootstrapInfo = `
${detectedStr}
${scriptsList}
${configStr}
${portsStr}
${installStr}
${warnStr}

NOTE: Use the exact scripts listed above for THIS repository. Commands vary by project - do not assume standard commands like "npm install" work everywhere. Use what was detected.`
    }

    const systemPrompt = `You are Pocket, an autonomous coding agent.

Repository: ${updatedSession.task}
Branch: ${updatedSession.branchName ?? 'N/A'}${bootstrapInfo}

Use tools to explore and make changes as needed.

IMPORTANT: When you finish making changes, always use the git_commit tool to save them with a clear message, then use git_push to push your branch to origin. Do not just say you will commit or push — actually call the tools.`

    const runner = new AgentRunner({
      sessionId: id,
      provider,
      eventLog,
      tools: registry,
      model: updatedSession.model,
      systemPrompt,
      startingSeq: updatedSession.nextSeq,
      workspaceRoot,
      githubToken: updatedSession.githubToken,
      sandboxImage: updatedSession.sandboxImage,
      permissionGate,
      onPermissionAlwaysAllow: (toolName) => {
        sessionManager.persistPermissionRule(id, toolName, 'allow')
      },
      onEvent: (event) => {
        emitToSession(id, event)
      },
    })

    sessionManager.setRunner(id, runner)

    // Run the turn asynchronously
    runner.runTurn({ role: 'user', content }).then(() => {
      const updated = sessionManager.updateSession(id, {
        nextSeq: runner.getSeq(),
        status: runner.isAborted ? 'done' : 'idle',
      })
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      sessionManager.updateSession(id, { status: 'error' })
    })

    return { ok: true, sessionId: id }
  })

  // Abort agent
  app.post('/api/sessions/:id/abort', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runner = sessionManager.getRunner(id)
    if (!runner) {
      return reply.status(404).send({ error: 'No active agent for this session' })
    }
    runner.abort()
    return { ok: true }
  })

  // Resolve permission
  app.post('/api/sessions/:id/permission', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { permissionId, resolution, alwaysAllow } = request.body as {
      permissionId: string
      resolution: 'allow' | 'deny'
      alwaysAllow?: boolean
    }

    const runner = sessionManager.getRunner(id)
    if (!runner) {
      return reply.status(404).send({ error: 'No active agent for this session' })
    }

    await runner.resolvePermission(permissionId, resolution, alwaysAllow)
    return { ok: true }
  })

  // Manual commit
  app.post('/api/sessions/:id/commit', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { message } = request.body as { message?: string }

    const session = sessionManager.getSession(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    if (!session.localPath) {
      return reply.status(400).send({ error: 'Workspace not ready' })
    }

    try {
      const ctx = {
        sessionId: id,
        workspaceRoot: session.localPath,
        githubToken: session.githubToken,
        resolvePath: (inputPath: string) => {
          const resolved = path.resolve(session.localPath!, inputPath)
          if (!resolved.startsWith(session.localPath!)) {
            throw new Error(`Path escapes workspace: ${inputPath}`)
          }
          return resolved
        },
      }
      const gen = gitCommitTool.call({ message: message ?? 'Manual commit' }, ctx)
      let result = await gen.next()
      while (!result.done) {
        result = await gen.next()
      }
      return { ok: true, result: result.value }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: msg })
    }
  })

  // Manual PR creation
  app.post('/api/sessions/:id/pr', async (request, reply) => {
    const { id } = request.params as { id: string }

    const session = sessionManager.getSession(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    if (!session.localPath) {
      return reply.status(400).send({ error: 'Workspace not ready' })
    }

    try {
      const ctx = {
        sessionId: id,
        workspaceRoot: session.localPath,
        githubToken: session.githubToken,
        resolvePath: (inputPath: string) => {
          const resolved = path.resolve(session.localPath!, inputPath)
          if (!resolved.startsWith(session.localPath!)) {
            throw new Error(`Path escapes workspace: ${inputPath}`)
          }
          return resolved
        },
      }
      const gen = githubCreatePRTool.call({}, ctx)
      let result = await gen.next()
      while (!result.done) {
        result = await gen.next()
      }
      return { ok: true, result: result.value }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: msg })
    }
  })

  // Cleanup workspaces older than 30 days for done/archived sessions
  cleanupOldWorkspaces(options.sessionsDir)
  setInterval(() => cleanupOldWorkspaces(options.sessionsDir), 24 * 60 * 60 * 1000)

  return app
}

async function runWorkspaceSetup(
  session: import('@pocket/core').SessionMeta,
  sessionManager: SessionManager,
  eventLog: EventLog,
  emitToSession: (sessionId: string, event: Event) => void,
  bootstrapResults: Map<string, any>,
): Promise<void> {
  const id = session.id
  const setupToolCallId = `workspace-setup-${Date.now()}`
  const setupToolName = session.isLocal ? 'init_local_repo' : 'clone_repo'

  // Emit tool_call_start
  const startEvent: Event = {
    seq: session.nextSeq++,
    ts: Date.now(),
    type: 'tool_call_start',
    payload: {
      toolCallId: setupToolCallId,
      toolName: setupToolName,
      args: { repoUrl: session.repoUrl, sessionId: id, isLocal: session.isLocal },
    },
  }
  eventLog.append(id, startEvent)
  emitToSession(id, startEvent)

  // Emit status: cloning
  const statusEvent: Event = {
    seq: session.nextSeq++,
    ts: Date.now(),
    type: 'status',
    payload: { status: 'cloning', message: 'Setting up workspace...' },
  }
  eventLog.append(id, statusEvent)
  emitToSession(id, statusEvent)

  let workspaceRoot: string

  try {
    if (session.isLocal) {
      workspaceRoot = await initLocalRepo(id, (message) => {
        const progressEvent: Event = {
          seq: session.nextSeq++,
          ts: Date.now(),
          type: 'tool_call_progress',
          payload: {
            toolCallId: setupToolCallId,
            toolName: setupToolName,
            message,
          },
        }
        eventLog.append(id, progressEvent)
        emitToSession(id, progressEvent)
      })
    } else {
      workspaceRoot = await cloneRepo(session.repoUrl, id, session.githubToken, (message) => {
        const progressEvent: Event = {
          seq: session.nextSeq++,
          ts: Date.now(),
          type: 'tool_call_progress',
          payload: {
            toolCallId: setupToolCallId,
            toolName: setupToolName,
            message,
          },
        }
        eventLog.append(id, progressEvent)
        emitToSession(id, progressEvent)
      })
    }

    // Persist localPath and advance nextSeq
    sessionManager.updateSession(id, {
      localPath: workspaceRoot,
      status: 'ready',
      nextSeq: session.nextSeq,
    })

    // Emit status: ready
    const readyEvent: Event = {
      seq: session.nextSeq++,
      ts: Date.now(),
      type: 'status',
      payload: { status: 'ready', message: 'Workspace ready' },
    }
    eventLog.append(id, readyEvent)
    emitToSession(id, readyEvent)

    // Eagerly initialize sandbox container (pull image, start container)
    if (session.sandboxImage && isPodmanAvailable()) {
      const sandboxStartEvent: Event = {
        seq: session.nextSeq++,
        ts: Date.now(),
        type: 'status',
        payload: { status: 'ready', message: 'Starting sandbox container...' },
      }
      eventLog.append(id, sandboxStartEvent)
      emitToSession(id, sandboxStartEvent)

      try {
        await ensureContainer(id, session.sandboxImage, workspaceRoot)
        const sandboxReadyEvent: Event = {
          seq: session.nextSeq++,
          ts: Date.now(),
          type: 'status',
          payload: { status: 'ready', message: `Sandbox ready (${session.sandboxImage})` },
        }
        eventLog.append(id, sandboxReadyEvent)
        emitToSession(id, sandboxReadyEvent)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const sandboxWarnEvent: Event = {
          seq: session.nextSeq++,
          ts: Date.now(),
          type: 'status',
          payload: { status: 'ready', message: `[warn] Sandbox unavailable: ${msg}. Bash tool will report errors per-call.` },
        }
        eventLog.append(id, sandboxWarnEvent)
        emitToSession(id, sandboxWarnEvent)
      }

      sessionManager.updateSession(id, { nextSeq: session.nextSeq })
    }

    // ─── Auto-bootstrap the repository ─────────────────────────────
    const bootstrapEvent: Event = {
      seq: session.nextSeq++,
      ts: Date.now(),
      type: 'status',
      payload: { status: 'working', message: 'Analyzing repository...' },
    }
    eventLog.append(id, bootstrapEvent)
    emitToSession(id, bootstrapEvent)

    try {
      const bootstrapCtx = {
        sessionId: id,
        workspaceRoot,
        githubToken: session.githubToken,
        sandboxImage: session.sandboxImage ?? undefined,
        resolvePath: (inputPath: string) => {
          if (!workspaceRoot) throw new Error('Workspace not ready')
          const resolved = path.resolve(workspaceRoot, inputPath)
          if (!resolved.startsWith(workspaceRoot)) {
            throw new Error(`Path escapes workspace: ${inputPath}`)
          }
          return resolved
        },
      }

      const gen = bootstrapRepoTool.call({}, bootstrapCtx)
      let result = await gen.next()
      while (!result.done) {
        const progress = result.value
        if (progress.type === 'progress') {
          const progressEvent: Event = {
            seq: session.nextSeq++,
            ts: Date.now(),
            type: 'tool_call_progress',
            payload: {
              toolCallId: 'bootstrap-repo',
              toolName: 'bootstrap_repo',
              message: progress.message,
            },
          }
          eventLog.append(id, progressEvent)
          emitToSession(id, progressEvent)
        }
        result = await gen.next()
      }
      const bootstrapResult = result.value
      bootstrapResults.set(id, bootstrapResult)
      sessionManager.updateSession(id, { nextSeq: session.nextSeq })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const bootstrapErrorEvent: Event = {
        seq: session.nextSeq++,
        ts: Date.now(),
        type: 'status',
        payload: { status: 'ready', message: `[warn] Bootstrap issue: ${msg.slice(0, 100)}` },
      }
      eventLog.append(id, bootstrapErrorEvent)
      emitToSession(id, bootstrapErrorEvent)
      sessionManager.updateSession(id, { nextSeq: session.nextSeq })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const errorEvent: Event = {
      seq: session.nextSeq++,
      ts: Date.now(),
      type: 'status',
      payload: { status: 'error', message: `Workspace setup failed: ${message}` },
    }
    eventLog.append(id, errorEvent)
    emitToSession(id, errorEvent)
    sessionManager.updateSession(id, { status: 'error', nextSeq: session.nextSeq })
    throw err
  }
}

function cleanupOldWorkspaces(sessionsDir: string): void {
  const workspacesDir = getWorkspaceDir()
  if (!fs.existsSync(workspacesDir)) return

  const sessionDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())

  for (const sessionEntry of sessionDirs) {
    const sessionId = sessionEntry.name
    const metaPath = path.join(sessionsDir, sessionId, 'meta.json')
    if (!fs.existsSync(metaPath)) continue

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      if (meta.status !== 'done' && meta.status !== 'archived') continue

      const workspacePath = path.join(workspacesDir, sessionId)
      if (!fs.existsSync(workspacePath)) continue

      const stats = fs.statSync(workspacePath)
      const thirtyDays = 30 * 24 * 60 * 60 * 1000
      if (Date.now() - stats.mtimeMs > thirtyDays) {
        fs.rmSync(workspacePath, { recursive: true, force: true })
      }
    } catch {
      // skip
    }
  }
}

// ─── Startup (when run directly, not imported for tests) ───

const isMainModule = process.argv[1]?.includes('index.ts') || process.argv[1]?.includes('index.js')

if (isMainModule) {
  const PORT = parseInt(process.env.PORT || '5173', 10)
  const sessionsDir = path.join(os.homedir(), '.pocket', 'sessions')

  if (!isPodmanAvailable()) {
    console.warn('[Pocket] Podman not found. Sandbox isolation is disabled. Install podman for sandbox support.')
  }

  buildApp({ sessionsDir }).then(app => {
    return app.listen({ port: PORT, host: '0.0.0.0' })
  }).then(() => {
    console.log(`[Pocket] Server listening on http://localhost:${PORT}`)
  }).catch(err => {
    console.error('[Pocket] Failed to start:', err)
    process.exit(1)
  })

  // Clean up all sandbox containers on shutdown
  const shutdown = async () => {
    console.log('[Pocket] Shutting down, cleaning up sandbox containers...')
    await killAllContainers()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
