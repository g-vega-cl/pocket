import type { ZodSchema } from 'zod'

// ─── Events (§3) ───────────────────────────────────────────

export type EventType =
  | 'user_message'
  | 'assistant_text_delta'
  | 'assistant_text_done'
  | 'tool_call_start'
  | 'tool_call_progress'
  | 'tool_call_result'
  | 'permission_requested'
  | 'permission_resolved'
  | 'status'
  | 'token_usage'
  | 'compact_marker'

export interface Event<T extends EventType = EventType> {
  seq: number
  ts: number
  type: T
  payload: EventPayloadMap[T]
}

export interface EventPayloadMap {
  user_message: { content: string }
  assistant_text_delta: { text: string; reasoning?: string; model?: string }
  assistant_text_done: { text: string; reasoning?: string; model?: string }
  tool_call_start: { toolCallId: string; toolName: string; args: Record<string, unknown> }
  tool_call_progress: { toolCallId: string; toolName: string; message: string }
  tool_call_result: { toolCallId: string; toolName: string; result?: unknown; error?: string }
  permission_requested: { permissionId: string; toolName: string; toolCallId: string; args: Record<string, unknown>; reason: string }
  permission_resolved: { permissionId: string; toolName: string; resolution: 'allow' | 'deny'; alwaysAllow?: boolean }
  status: { status: SessionStatus; message?: string }
  token_usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  compact_marker: { boundary: string }
}

// ─── Session (§3) ──────────────────────────────────────────

export type SessionStatus =
  | 'creating'
  | 'cloning'
  | 'sandboxing'
  | 'ready'
  | 'working'
  | 'idle'
  | 'awaiting_permission'
  | 'awaiting_plan_approval'
  | 'done'
  | 'error'
  | 'interrupted'

export interface SessionMeta {
  id: string
  repoUrl: string
  task: string
  model: string
  branchName: string | null
  localPath: string | null
  status: SessionStatus
  createdAt: number
  lastActivity: number
  nextSeq: number
  isLocal: boolean
  githubToken?: string
  sandboxImage?: string
}

// ─── Messages (§4, §10) ────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface Message {
  role: MessageRole
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// ─── Tool interface (§5) ───────────────────────────────────

export type PermissionLevel = 'allow' | 'ask' | 'conditional' | 'rule-matched'

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolContext {
  sessionId: string
  workspaceRoot: string
  githubToken?: string
  sandboxImage?: string
  resolvePath: (inputPath: string) => string
}

export type Progress = { type: 'progress'; message: string }

export interface Tool<I = Record<string, unknown>, O = unknown> {
  name: string
  description: string
  inputSchema: ZodSchema<I>
  isReadOnly: boolean
  defaultPermission: PermissionLevel
  call(input: I, ctx: ToolContext): AsyncGenerator<Progress, O>
}

// ─── Tool execution (§5) ───────────────────────────────────

export interface ExecutedToolCall {
  toolCallId: string
  toolName: string
  result?: unknown
  error?: string
}

// ─── Permission system (§6) ─────────────────────────────────

export type PermissionResolution = 'allow' | 'deny'

export interface PermissionRequest {
  permissionId: string
  toolName: string
  toolCallId: string
  args: Record<string, unknown>
  reason: string
  sessionId: string
  resolve: (resolution: PermissionResolution, alwaysAllow?: boolean) => void
  timeout?: NodeJS.Timeout
}

export interface PermissionDefaults {
  [toolName: string]: PermissionLevel
}

export interface BashRuleConfig {
  bashAllow: string[]
  bashDeny: string[]
}

export interface WatchdogConfig {
  maxTurns: number
  maxToolErrorStreak: number
  noDeltaNudgeAt: number
  toolRepetitionCount: number
}

export interface PocketConfig {
  bashAllow: string[]
  bashDeny: string[]
  protectedBranches: string[]
  processBufferSize: number
  maxBackgroundProcesses: number
  defaultSandboxImage: string
  watchdog: WatchdogConfig
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  maxTurns: 50,
  maxToolErrorStreak: 3,
  noDeltaNudgeAt: 4,
  toolRepetitionCount: 3,
}

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master', 'develop', 'pocket', 'staging', 'production']

export const DEFAULT_SANDBOX_IMAGE = 'docker.io/nikolaik/python-nodejs:python3.12-nodejs22'

export * from './learning.js'

export const DEFAULT_BASH_DENY = [
  ':\\(\\)\\{ :\\|:& \\};:',  // fork bomb
  '^rm -rf /',                 // delete root
  '^sudo ',                    // privilege escalation
]

// ─── LLM Provider (§10) ────────────────────────────────────

export interface LLMChunk {
  type: 'text' | 'tool_call' | 'reasoning'
  text?: string
  reasoning?: string
  toolCall?: {
    id: string
    name: string
    arguments: string
  }
  /** The actual model used by the provider (may differ from requested due to fallback) */
  model?: string
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatRequest {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens?: number
}

export interface ModelCapabilities {
  contextWindow: number
  supportsTools: boolean
  supportsReasoning: boolean
}

export interface LLMProvider {
  streamChat(req: ChatRequest): AsyncGenerator<LLMChunk, ChatUsage>
  countTokens(messages: Message[]): number
  capabilities(model: string): ModelCapabilities
}

// ─── Background processes (§7) ─────────────────────────────

export type BackgroundProcessStatus = 'running' | 'exited' | 'killed' | 'lost'

export interface BackgroundProcess {
  id: string
  pid: number | null
  command: string
  startedAt: number
  status: BackgroundProcessStatus
  exitCode: number | null
  cwd: string
}

export interface BashReadMode {
  mode: 'since_last_read' | 'tail' | 'all'
  lines?: number
  stream?: 'stdout' | 'stderr' | 'both'
}

export interface BashReadResult {
  stdout: string
  stderr: string
  isRunning: boolean
  droppedLines: number
}
