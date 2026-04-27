import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '..', '..', '..', '.env') })

import { SessionManager, EventLog, ToolRegistry, AgentRunner, ProcessManager } from '@pocket/agent'
import { OpenRouterProvider } from '@pocket/llm'
import {
  readFileTool, listFilesTool, writeFileTool, editFileTool,
  bashTool, grepTool, globTool, webFetchTool, webSearchTool,
  planTool, todosWriteTool,
  gitStatusTool, gitLogTool, gitDiffTool,
  gitCreateBranchTool, gitCommitTool, gitPushTool,
  githubCreatePRTool,
  createBackgroundTools,
  getWorkspaceDir,
} from '@pocket/tools'
import type { Event } from '@pocket/core'

interface BuildOptions {
  sessionsDir: string
  env?: Record<string, string | undefined>
}

export async function buildApp(options: BuildOptions) {
  const app = Fastify({ logger: false })

  await app.register(cors, { origin: true })

  const eventLog = new EventLog(options.sessionsDir)
  const sessionManager = new SessionManager(options.sessionsDir, eventLog)

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

  // Create session
  app.post('/api/sessions', async (request, reply) => {
    const body = request.body as any
    if (!body.repoUrl || !body.task || !body.model) {
      return reply.status(400).send({ error: 'repoUrl, task, and model are required' })
    }

    const session = sessionManager.createSession({
      repoUrl: body.repoUrl,
      task: body.task,
      model: body.model,
      githubToken: body.githubToken,
      isLocal: body.isLocal ?? false,
    })

    return {
      id: session.id,
      repoUrl: session.repoUrl,
      task: session.task,
      model: session.model,
      status: session.status,
      createdAt: session.createdAt,
    }
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
    const systemPrompt = `You are Pocket, an autonomous coding agent.

Repository: ${session.repoUrl}
Task: ${session.task}
Branch: ${session.branchName ?? 'N/A'}
Status: ${session.status}

Use tools to explore and make changes as needed.`

    const runner = new AgentRunner({
      sessionId: id,
      provider,
      eventLog,
      tools: registry,
      model: session.model,
      systemPrompt,
      startingSeq: session.nextSeq,
      workspaceRoot: session.localPath ?? '',
      githubToken: session.githubToken,
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

  // Cleanup workspaces older than 30 days for done/archived sessions
  cleanupOldWorkspaces(options.sessionsDir)
  setInterval(() => cleanupOldWorkspaces(options.sessionsDir), 24 * 60 * 60 * 1000)

  return app
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

  buildApp({ sessionsDir }).then(app => {
    return app.listen({ port: PORT, host: '0.0.0.0' })
  }).then(() => {
    console.log(`[Pocket] Server listening on http://localhost:${PORT}`)
  }).catch(err => {
    console.error('[Pocket] Failed to start:', err)
    process.exit(1)
  })
}
