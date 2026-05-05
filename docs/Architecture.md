# Pocket — Architecture (v1)

> A self-hosted coding agent you drive from your phone. The server runs on your home machine and exposes a tunneled web client. The agent works on your repos, opens PRs, and keeps going while your phone is locked.
>
> **Status: implemented.** This document describes the system as built. Sections marked `[plan]` were design rationale written before implementation.

---

## 1. Guiding principles

These are not platitudes — every decision in this doc traces back to one of them.

1. **The server is the source of truth.** The client is a window into it. Closing the tab must never stop the agent or lose state.
2. **Append-only, replayable.** Sessions are an event log on disk. Anything the client missed can be replayed. This is how reconnection becomes a non-feature.
3. **The agent loop is small. The systems around it are large.** Following Claude Code's design: a 50-line `while` loop calls the model and runs tools. Permissions, persistence, and recovery live in the systems around it.
4. **Permissions over prompts.** A remote agent that constantly halts for approval is useless. Sensible auto-allow defaults plus a "pending approvals" queue that survives disconnect.
5. **Defer cleverness.** No subagents, no compaction pipeline, no MCP, no hooks in v1. They have a designed-in seam, but no implementation.
6. **One transport, one protocol.** SSE for server→client, REST for client→server. No WebSockets, no polling.

---

## 2. System overview

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (TanStack Start, served by the same Node process)   │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  EventSource ──► /api/sessions/:id/events  (SSE)     │   │
│   │  fetch ─────────► /api/sessions/:id/...    (REST)    │   │
│   └──────────────────────────────────────────────────────┘   │
└─────────────────────────────┬────────────────────────────────┘
                              │  Cloudflare tunnel (HTTPS)
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Node server (single process)                                │
│                                                              │
│   ┌───────────────────┐    ┌──────────────────────────────┐  │
│   │  HTTP layer        │   │  SessionManager              │  │
│   │  (Fastify)          │──►│  (in-memory map, owns        │  │
│   │  REST + SSE        │   │   AgentRunner instances)     │  │
│   └───────────────────┘    └──────────┬───────────────────┘  │
│                                       │ owns                  │
│                                       ▼                       │
│                            ┌────────────────────────────┐    │
│                            │  AgentRunner (per session) │    │
│                            │  • runs the query loop     │    │
│                            │  • emits events            │    │
│                            │  • blocks on permissions   │    │
│                            └──────────┬─────────────────┘    │
│                                       │                       │
│              ┌────────────────────────┼────────────────────┐ │
│              ▼                        ▼                    ▼ │
│      ┌─────────────┐          ┌──────────────┐    ┌────────┐│
│      │  LLM client │          │ Tool         │    │ Event  ││
│      │ (OpenRouter,│          │ Executor +   │    │ Log    ││
│      │  streaming) │          │ Permission   │    │(JSONL) ││
│      └─────────────┘          │ Gate         │    └────────┘│
│                               └──────┬───────┘               │
│                                      │                        │
│                                      ▼                        │
│                          ┌────────────────────────┐           │
│                          │  Tools                 │           │
│                          │  fs · git · bash · web │           │
│                          │  · plan · todos · gh   │           │
│                          └────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 ~/.pocket/sessions/{id}/
                 ~/.pocket/workspaces/{id}/  (cloned repo)
```

One process, one port. The web client is served by the same Node process that runs the agent — no Vite dev server in production, no separate frontend deployment. In dev, Vite proxies the API and SSE through to the same process.

---

## 3. The session — your fundamental unit

A session is a directory:

```
~/.pocket/sessions/{sessionId}/
├── meta.json         ← repo, task, model, branch, status, timestamps
├── events.jsonl      ← append-only event log (the source of truth)
└── permissions.json  ← session-scoped permission grants ("always allow X")

~/.pocket/workspaces/{sessionId}/
└── {repo}/           ← the cloned repo, agent's CWD
```

**Two key separations:**
- Metadata (`meta.json`) is small and frequently overwritten. Cheap.
- The conversation history is **derived from `events.jsonl`** — it's not stored separately. To reconstruct the chat, you replay the log. This is the same insight as Claude Code's append-oriented session storage and Git's object model.
- The repo workspace is large and lives in a separate tree so deleting old workspaces doesn't touch session metadata.

### Event log shape

Every event is a single JSON line with `{ seq, ts, type, ...payload }`. The `seq` is a monotonic integer per session — this is what powers SSE resume.

Event types (v1, deliberately small):

| Type | Emitted when |
|---|---|
| `user_message` | User sent a chat message |
| `assistant_text_delta` | LLM streamed text token(s) |
| `assistant_text_done` | LLM finished a text block |
| `tool_call_start` | Agent decided to call a tool (args known) |
| `tool_call_progress` | Long tool emitted progress (e.g. cloning) |
| `tool_call_result` | Tool returned (success or error) |
| `permission_requested` | Agent wants to do something that needs approval |
| `permission_resolved` | User answered a permission request |
| `status` | `creating`, `cloning`, `ready`, `working`, `idle`, `done`, `error` — derived state |
| `compact_marker` | (v1.5) marks a compaction boundary |

The `assistant_text_delta` and `assistant_text_done` events carry a `model` field (the actual model that served the response, or `undefined` if unknown). This is how the UI displays the model name below assistant message bubbles — especially useful when OpenRouter falls back to a backup model.

**Why this shape:** the client UI is a deterministic function of the event log. Refreshing the page replays events. Reconnecting after a phone-lock replays from `lastSeenSeq`. Two tabs viewing the same session show the same thing because they're rendering the same log.

---

## 4. The query loop

This is the heart. It is intentionally a small, readable async generator.

```ts
// The AgentRunner in packages/agent/src/agent-runner.ts
async function* runTurn(session: Session, userMessage: Message) {
  session.appendEvent({ type: 'user_message', content: userMessage });
  session.setStatus('working');

  while (true) {
    const messages = session.buildMessageHistory();
    const stream = llm.streamChat({ messages, tools: enabledTools, model: session.model });

    let toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      if (chunk.type === 'text')
        yield session.appendEvent({ type: 'assistant_text_delta', text: chunk.text });
      else if (chunk.type === 'tool_call')
        toolCalls.push(chunk.toolCall);
    }

    if (toolCalls.length === 0) break; // model is done

    // Execute tools (read-only in parallel, writes serial)
    // Each tool is checked against PermissionGate before execution.
    // If 'ask', the runner emits permission_requested and awaits
    // user resolution via POST /api/sessions/:id/permission.
    const results = await toolExecutor.runBatch(toolCalls, session);
    for (const r of results)
      session.appendEvent({ type: 'tool_call_result', ...r });
    // loop back: send tool results to LLM
  }

  session.setStatus('idle');
}
```

**What's deliberately missing:**
- No "after-turn auto-commit." Auto-commit happens on a separate user-triggered event or via a tool the agent calls. Bundling it into the loop conflates concerns.
- No reasoning/thinking handling shown — that's just another delta type the LLM client normalizes.
- No manual retries or context-collapse — those wrap this loop, they don't pollute it.

**Reliability & Cost Optimization (v1.1):**
- **Automatic Fallbacks:** The LLM provider sends a list of models to OpenRouter: `[primary, backup1, backup2]`. This tells OpenRouter to try the primary model first, then fall back to `minimax/minimax-m2.5`, then `stepfun/step-3.5-flash`. This provides robust zero-config reliability.
- **Model tracking:** The agent captures `parsed.model` from OpenRouter SSE responses (the `/v1/chat/completions` endpoint returns the actual model in every data line). When a fallback occurs, the actual model differs from the requested one. This is propagated through `LLMChunk.model` → `assistant_text_done.model` → `ChatMessage.model` and displayed in the UI. If the model differs from the session's configured model, it appears with an orange warning indicator and a tooltip showing "Requested: X — Fallback: Y".
- **Response Caching:** The `X-OpenRouter-Cache: true` header is enabled. Identical requests within 5 minutes are served from cache at zero cost.
- **Prompt Caching:** For Anthropic models, `cache_control` markers are automatically added to the system prompt and recent history (up to 4 breakpoints), reducing costs for long conversations by 90%.

**Loop termination guarantees:**
- Hard cap on turns per user message (e.g. 50). Prevents runaway loops.
- Hard cap on tokens per session (your chosen pre-compaction strategy — see §8).
- AbortController on every session — user can stop the agent at any time.
- **Duplicate write tool call detection.** If the model issues the same write tool with identical arguments 3 times in a single turn, the executor blocks it with an error. This breaks edit-loop stalls where a weaker model keeps retrying the same failing `edit_file` call because its conversation history is corrupted.

**Message reconstruction:**
The event log is replayed to build the LLM's conversation history on every turn. Tool calls and their results are grouped per-assistant-response, not lumped together. This ensures multi-turn sessions maintain correct context — the model sees which tools it called in each iteration and what they returned.

---

## 5. Tools

A tool is a uniform interface. Every tool — file ops, git, web fetch, plan, todos — implements the same contract.

```ts
interface Tool<I, O> {
  name: string;                     // "read_file"
  description: string;              // shown to the LLM
  inputSchema: ZodSchema<I>;        // also generates the JSON schema sent to LLM
  isReadOnly: boolean;              // determines parallel vs serial execution
  defaultPermission: 'allow' | 'ask' | 'conditional' | 'rule-matched'; // see §6
  call(input: I, ctx: ToolContext): AsyncGenerator<Progress, O>;
}
```

The `call` is an async generator so long-running tools (clone, bash) can stream progress back as `tool_call_progress` events. Non-streaming tools just yield once at the end.

### v1 tool inventory

| Tool | Read-only | Default permission | Notes |
|---|---|---|---|
| `read_file` | ✓ | allow | path must be inside workspace |
| `list_files` | ✓ | allow | gitignore-aware |
| `grep` | ✓ | allow | ripgrep wrapper, paginated, capped output |
| `glob` | ✓ | allow | for "find files matching X" |
| `web_fetch` | ✓ | allow | for agent research, capped size |
| `web_search` | ✓ | allow | OpenRouter / SerpAPI / similar |
| `git_status` / `git_log` / `git_diff` | ✓ | allow | read-only git |
| `write_file` | ✗ | allow (in workspace) / ask (outside) | enforced by path check |
| `edit_file` | ✗ | allow (in workspace) | string-replace style edits |
| `git_create_branch` | ✗ | allow | per your trust model |
| `git_commit` | ✗ | allow | per your trust model |
| `git_push` | ✗ | allow | per your trust model |
| `github_create_pr` | ✗ | allow | PR to `main` base branch |
| `bash` | ✗ | **rule-matched** (see §6) | per-command matchers, default ask |
| `bash_background` | ✗ | **rule-matched** (same matchers as bash) | spawns long-running process, returns immediately |
| `bash_read_output` | ✓ | allow | read buffered output from a background process |
| `bash_send_input` | ✗ | ask | write to a background process's stdin |
| `bash_kill` | ✗ | allow | terminate a background process |
| `list_processes` | ✓ | allow | list this session's background processes |
| `plan` | ✗ | allow | writes a plan, sets `awaiting_plan_approval` |
| `todos_write` | ✗ | allow | agent's own scratchpad task list |
| `bootstrap_repo` | ✓ | allow | analyzes cloned repo: detects project type, package manager, scripts, config files, runs dependency install |

### Read-only parallelism

The executor partitions a batch of tool calls: read-only tools run concurrently with `Promise.allSettled`, write tools run sequentially. This matches Claude Code's pattern and gives 3–5× speedups on file exploration.

### Path safety

Every file-touching tool resolves paths against `workspace_root` and rejects anything that escapes (`..` traversal, symlink-out, absolute paths). This is enforced once in `ToolContext.resolvePath()` rather than re-implemented per tool.

---

## 6. Permission system — the linchpin for remote operation

Because you're driving this from your phone, permissions are not an annoying ceremony — they're the difference between "agent works while I'm at lunch" and "agent halts immediately and I never see it."

### Decision pipeline

When a tool is about to run, the gate runs through these in order, first match wins:

```
Tool call arrives
   │
   ▼
1. Session-scoped allow rules  (you said "always allow bash for this session")
   │ no match
   ▼
2. Static defaults             (table in §5: read-only → allow, bash → rule-matched)
   │
   ▼
3. Tool-specific checks:
   ├─ bash  → checkBashCommand() sub-pipeline (see below)
   ├─ write_file / edit_file → allow inside workspace, ask outside
   └─ git_push → deny on protected branches, allow otherwise
   │
   ▼
4. Emit `permission_requested` event, agent loop awaits resolution
```

#### Bash sub-pipeline (checkBashCommand)

```
Bash command arrives
   │
   ▼
1. bashDeny patterns match?   → DENY   (hard block, no override)
   │ no match
   ▼
2. Sandbox active?            → ALLOW  (container IS the safety boundary)
   │ no sandbox
   ▼
3. Session rule "always allow"? → ALLOW
   │ no match
   ▼
4. bashAllow patterns match?  → ALLOW
   │ no match
   ▼
5. Default                    → ASK

### Trust model defaults (your choices, codified)

```ts
const v1Defaults: PermissionDefaults = {
  // Auto-allow, unconditionally
  read_file:           'allow',
  list_files:          'allow',
  grep:                'allow',
  glob:                'allow',
  git_status:          'allow',
  git_log:             'allow',
  git_diff:            'allow',
  git_create_branch:   'allow',
  git_commit:          'allow',
  github_create_pr:    'allow',
  web_fetch:           'allow',
  web_search:          'allow',

  // Allow inside workspace, ask outside
  write_file:          'conditional',
  edit_file:           'conditional',

  // Allow only on a non-protected branch
  git_push:            'conditional',

  // Per-command matchers, default ask
  bash:                'rule-matched',
};
```

`conditional` means the tool's `safetyCheck()` evaluates the input. For `write_file`/`edit_file`: allow if path is inside workspace, ask otherwise. For `git_push`: allow if current branch is not in the protected set, ask otherwise.

### Bash command matchers

Bash is the spiciest tool. A regex/glob matcher gates it:

```ts
// ~/.pocket/config.json  (overridable per-session)
{
  "bashAllow": [
    // Test runners and builds
    "^npm (run )?(test|build|lint|typecheck|format)( .*)?$",
    "^pnpm (run )?(test|build|lint|typecheck|format)( .*)?$",
    "^yarn (test|build|lint|typecheck|format)( .*)?$",
    "^npx tsc( .*)?$",
    "^nx (test|build|lint|typecheck|run|run-many)( .*)?$",

    // Read-only diagnostics
    "^ls( .*)?$",
    "^cat [^|;&`$()]*$",       // cat with a single arg, no shell metacharacters
    "^pwd$",
    "^echo [^|;&`$()]*$",
    "^which .*$",
    "^node --version$",
    "^node -v$"
  ],
  "bashDeny": [
    // Hard deny — these never auto-allow, even in sandbox or with "always allow"
    ":\\(\\)\\{ :\\|:& \\};:",   // fork bomb
    "^rm -rf /",                 // delete root
    "^sudo "                     // privilege escalation
  ]
}
```

**Match logic** (in this order):
1. If any `bashDeny` regex matches → **deny** (no override, even in sandbox or by "always allow")
2. If sandbox is active → **allow** (the container handles isolation — deny list is the only gate)
3. If session has "always allow bash" → **allow**
4. If any `bashAllow` regex matches → **allow**
5. Otherwise → **ask**

**Sandbox auto-allow:** When `sandboxImage` is configured (which is always, by default), all bash commands that pass the deny check are auto-allowed. The container is the safety boundary — it isolates filesystem access, limits network exposure, and prevents host tampering. This gives the agent full autonomy while keeping the host safe.

**Why the auto-allow is safe:**
- Commands run inside a Podman rootless container, not on the host
- The only shared filesystem is the workspace volume mount (`/work`)
- All other tool paths (file reads/writes, git operations) are path-isolated via `resolvePath()`
- The deny list blocks catastrophic commands regardless of sandbox state

**Why a deny list at all:**
Defense in depth. Even inside a container, `rm -rf /` destroys the workspace. A fork bomb consumes host CPU. The deny list is intentionally tiny — it's a panic brake, not a sandbox replacement. Default deny patterns are built in (`DEFAULT_BASH_DENY`) and users can extend them in config.

### Protected branches (for `git_push`)

```ts
const protectedBranches = ['main', 'master', 'develop', 'pocket', 'staging', 'production'];
```

`git_push` resolves `conditional`:
- If `git rev-parse --abbrev-ref HEAD` returns a name in `protectedBranches` → **deny** (hard error)
- If detached HEAD (e.g. mid-rebase) → **deny** (hard error)
- Otherwise → **allow**

This means the agent can freely push the working branch (`pocket/{timestamp}-{slug}`) but is blocked before pushing to `main` even if it somehow checked it out. The tool itself enforces this at runtime, not via the permission gate.

**Push timeout:** `git_push` uses `spawn` with a **60-second timeout** to prevent indefinite hangs on credential prompts or network stalls. If the timeout fires, the tool returns an error that the agent can surface to you.

The protected list is per-session-overridable via the same permissions config.

### How "ask" works without blocking the loop

When a tool needs approval, the agent emits `permission_requested` and the runner awaits a Promise. The Promise resolves when one of:
- User clicks Allow / Deny / Always Allow in the client (REST POST: `/api/sessions/:id/permission`)
- User selects "Always allow this tool for this session" — writes to `permissions.json`, sets a session-scoped allow rule in the `PermissionGate`, and resolves Allow
- The turn is aborted (user clicks Stop) — all pending permissions resolve as Deny

**Critical UX detail:** when the user reconnects, the client receives all unresolved `permission_requested` events as part of the replay. The UI shows them as a "pending approvals" queue, not as a single blocking modal. This is what makes "agent worked while phone was locked, now I review the queue" feel natural.

**Permission persistence:** session-scoped allow rules (from "Always Allow") are saved to `~/.pocket/sessions/{id}/permissions.json` and loaded back into the `PermissionGate` on server restart. This means "Always Allow" survives server restarts for that session.

### Web push (deferred to v1.5)

Browser Push API for "agent needs your approval" notifications. Designed-in but not implemented in v1 — you'll just see a count badge when you reopen the tab.

---

## 7. Background processes

Some commands shouldn't block the agent loop — `npm run dev`, `nx serve`, file watchers, anything that's "start it and then come back to it." Pocket models these as first-class session resources.

### The process manager

Each session owns a `ProcessManager` that tracks its background processes. A process has:

```ts
interface BackgroundProcess {
  id: string;              // 'proc_a1b2c3' — stable, agent-facing
  pid: number;             // OS-level
  command: string;         // the original bash string
  startedAt: number;
  status: 'running' | 'exited' | 'killed';
  exitCode?: number;
  stdout: RingBuffer;      // capped at 4MB, line-aware
  stderr: RingBuffer;      // capped at 4MB, line-aware
  cwd: string;             // workspace path
}
```

The agent never sees PIDs — it only uses the stable `id`. PIDs change if the OS recycles them; the process manager tracks the mapping.

### Output buffering

Each stream is a ring buffer capped at 4MB (configurable). When full, the oldest *complete lines* are dropped, not raw bytes — never hand the LLM a half-line. The buffer also tracks a `lastReadOffset` per process so `bash_read_output` can return "everything new since I last looked."

At 4MB per stream × 2 streams × N processes, this can add up. The ProcessManager enforces a session-wide cap of 8 concurrent background processes; beyond that, new spawns require an `ask` confirmation regardless of the bash matchers. This prevents an agent in a tight loop from spawning hundreds of processes and OOMing the server.

### The four tools

```ts
// Spawn — returns immediately, agent gets the id
bash_background({ command: "npm run dev", cwd?: string })
  → { id: "proc_a1b2c3", pid: 12345 }

// Read — three modes for different agent intents
bash_read_output({
  id: "proc_a1b2c3",
  mode: "since_last_read" | "tail" | "all",
  lines?: number,           // for tail mode
  stream?: "stdout" | "stderr" | "both"  // default both, interleaved
})
  → { stdout: "...", stderr: "...", isRunning: true, droppedLines: 0 }

// Send input (for processes prompting on stdin — rare but real)
bash_send_input({ id: "proc_a1b2c3", input: "y\n" })
  → { ok: true }

// Kill — SIGTERM, then SIGKILL after 5s if still alive
bash_kill({ id: "proc_a1b2c3" })
  → { exitCode: -15, runtimeMs: 47230 }

// List — for the agent to see what it has running
list_processes()
  → [{ id, command, status, runtimeMs, hasUnreadOutput }, ...]
```

### Lifetime and crash recovery

Processes are **bound to the session.** When a session ends (status → `done` or explicit close), all its background processes get SIGTERM'd. The process manager registers an `exit` handler on the Node process to do this for the whole server, so a clean shutdown leaves no orphans.

The harder case: server crash. PIDs are persisted to `meta.json` after every spawn. On startup, the SessionManager:

1. Reads each session's tracked PIDs
2. For each PID, checks if it's still alive (`process.kill(pid, 0)`)
3. If alive: it's almost certainly an unrelated process by now (PID reuse) — emit a warning event, mark the process record as `lost`, do not adopt it
4. If dead: mark as `exited` with unknown exit code

The agent never inherits processes from a previous server run. This is intentional — it's safer to make the agent re-spawn than to adopt processes whose state is unknown.

### Why `bash_send_input` is `ask` by default

Sending input to a running process is rare and almost always indicates the agent is trying to answer an interactive prompt — exactly the moment you want a human in the loop. Most well-behaved tools have a `--yes` flag or non-interactive mode the agent should use first. If you find yourself approving this constantly, the right fix is usually a CLI flag, not auto-allowing the tool.

### What background processes are NOT for

- **Test runs you want to wait for** — that's `bash` (foreground), which already supports streaming output via the tool's progress events
- **Quick commands** — anything under ~30s should just be `bash`. Background processes have overhead (manager bookkeeping, PID persistence, ring buffers).
- **Persistent services** — Pocket isn't a process supervisor. Don't run production services through it.

### Bash timeout for foreground commands

Related question this raises: foreground `bash` needs a timeout, otherwise an agent that accidentally runs `npm run dev` (instead of `bash_background`) hangs the session forever. Default: **5 minutes**, configurable per-call up to 30 minutes. On timeout, the process gets SIGTERM, output is returned with `{ timedOut: true }`, and the agent can decide whether to re-run as background. This is a one-line addition to the existing bash tool, but it's load-bearing.

### Sandboxed execution

Bash commands (foreground) optionally run inside persistent Podman containers instead of directly on the host. This isolates build toolchains — no global npm, Python, or compiler installs on the server.

#### How it works

```
Session created with sandboxImage: "docker.io/nikolaik/python-nodejs:python3.12-nodejs22"
  │
  ▼
Workspace setup starts immediately: clone repo
  │
  ▼
Workspace ready → Eager init: ensureContainer(sessionId, image, workspaceRoot)
  → podman run -d --name pocket-{sessionId} -v {ws}:/work:Z -w /work {image} sleep infinity
  → Container stays alive for the session lifetime
  │
  ▼
Agent calls bash({ command: "tsc --noEmit" })
  → execInContainer("pocket-{sessionId}", "tsc --noEmit")
  → podman exec pocket-{sessionId} sh -c "tsc --noEmit"
  → Returns { stdout, stderr, exitCode }
  │
  ▼
Agent calls bash again → same container, tools cached, instant
  │
  ▼
30 min idle → container auto-stopped and removed
Next bash call → new container created
Session deleted / server shutdown → container cleaned up
```

#### Container lifecycle

- **Persistent:** Container starts on first user message (before the agent loop) via `ensureContainer()`. It stays alive with `sleep infinity`, keeping tool caches (`node_modules`, pip packages, git repos) warm between commands.
- **Workspace mount:** `-v {workspaceRoot}:/work:Z` — the `:Z` relabel handles SELinux on Fedora. Both Pocket (host) and the sandbox (container) see the same files. Files created by `npm install` inside the sandbox land in the host workspace.
- **Rootless:** Podman runs as the user, no daemon. Container `root` maps to the host UID, so file ownership is correct.
- **Network:** Allowed by default (`npm install`, `pip install`, `cargo build` need it).
- **Idle timeout:** After 30 minutes of inactivity (no bash commands), the container is stopped and removed. The next bash call starts a fresh one.
- **Session-bound:** The container is killed and removed when the session ends (status → `done`), the session is deleted, or the server shuts down.
- **Background processes** (`bash_background`) still use ephemeral `--rm` containers — one per process, destroyed on exit. This keeps long-running services isolated from the main session container.

#### Configuration

```json
// ~/.pocket/config.json
{
  "defaultSandboxImage": "docker.io/nikolaik/python-nodejs:python3.12-nodejs22"   // applied to all sessions
}
```

Per-session override on creation:

```ts
POST /api/sessions
{
  "repoUrl": "...",
  "task": "...",
  "model": "...",
  "sandboxImage": "python:3.12-slim"   // overrides default
}
```

#### Supported images

| Image | Size | Has |
|---|---|---|
| `docker.io/nikolaik/python-nodejs:python3.12-nodejs22` (default) | ~200MB | Node 22 + Python 3.12, npm, npx, pip |
| `node:22-alpine` | ~48MB | Node 22, npm, npx |
| `python:3.12-slim` | ~55MB | Python 3.12, pip |
| `rust:1-alpine` | ~100MB | Rust, cargo |

Any Podman-compatible OCI image works. The image is pulled on first use (on demand), and cached by Podman afterward.

#### Graceful fallback

- If Podman is not installed → container init emits a warning event but does not block. Bash commands try to use the sandbox and return `[sandbox] Container error:` in stderr if it fails. No silent fallback to host — the agent sees the error, the user sees the error.
- If `sandboxImage` is not configured (no config, no session override) → bash runs directly on the host via `execAsync`. Fully backward compatible.

#### Implementation

| File | Role |
|---|---|
| `packages/tools/src/sandbox.ts` | `isPodmanAvailable()`, `ensureContainer()`, `execInContainer()`, `stopSandboxContainer()`, `killAllContainers()`, `listActiveContainers()`, `runInSandbox()`, `spawnInSandbox()` |
| `packages/tools/src/bash.ts` | Routes through `ensureContainer` + `execInContainer` when `ctx.sandboxImage` is set |
| `packages/agent/src/process-manager.ts` | `spawn()` accepts optional `sandboxImage` — uses ephemeral `--rm` for background processes |
| `packages/tools/src/background.ts` | Passes `ctx.sandboxImage` to `ProcessManager.spawn()` (kept ephemeral) |
| `packages/agent/src/agent-runner.ts` | Stores `sandboxImage`, passes to `ToolContext`, includes in system prompt (`Sandbox: docker.io/nikolaik/python-nodejs:python3.12-nodejs22`) |
| `packages/agent/src/session-manager.ts` | Stores `sandboxImage` in session metadata, defaults from config; calls `stopSandboxContainer` on `deleteSession` |
| `apps/server/src/index.ts` | Accepts `sandboxImage` on `POST /api/sessions`, podman check at startup, triggers **workspace setup** (clone, eager sandbox init, bootstrap) immediately on session creation, `killAllContainers` on shutdown |
| `packages/core/src/index.ts` | `sandboxImage` field on `ToolContext`, `SessionMeta`, `PocketConfig` |

#### What sandboxing does NOT cover

- **File operations** (`read_file`, `write_file`, `edit_file`, `grep`, `glob`) — these run on the host filesystem. They don't need build tools, and they're already path-isolated via `resolvePath`.
- **Git operations** — clone, commit, push run on the host using the real git binary. The workspace filesystem is shared between host and sandbox, so changes made by either side are visible to the other.
- **LLM calls / web fetches** — OpenRouter API calls and `web_fetch`/`web_search` run from the Pocket process directly. These don't need a build toolchain.

---



## 8. Real-time transport — SSE + REST

### The endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sessions` | Create session, returns `{ id }`. Workspace setup (clone, sandbox, bootstrap) starts immediately and emits progress via SSE. |
| `GET` | `/api/sessions` | List sessions (for history page) |
| `GET` | `/api/sessions/:id` | Session metadata (status, model, branch) |
| `GET` | `/api/sessions/:id/events` | **SSE stream**, supports `Last-Event-ID` |
| `POST` | `/api/sessions/:id/messages` | Send chat message |
| `POST` | `/api/sessions/:id/abort` | Stop the agent mid-turn |
| `POST` | `/api/sessions/:id/permission` | Resolve a permission request |
| `POST` | `/api/sessions/:id/commit` | Manual commit |
| `POST` | `/api/sessions/:id/pr` | Create PR |
| `DELETE` | `/api/sessions/:id` | Archive session (workspace deletion is separate) |

### Why SSE specifically

- One TCP connection, one direction (server → client). Simple to reason about.
- `Last-Event-ID` header is built-in. The server reads it on (re)connect, opens `events.jsonl`, fast-forwards past that seq, and streams the rest. No custom replay protocol to design.
- `EventSource` handles automatic reconnection in the browser. You don't write the reconnect loop.
- Falls through Cloudflare tunnels, corporate proxies, every browser. WebSockets occasionally don't.
- Native HTTP means observability (curl, browser devtools) just works.

### The reconnect contract

```
Client opens SSE: GET /api/sessions/abc/events
  Header: Last-Event-ID: 47

Server:
  1. Open events.jsonl, seek past seq=47
  2. Stream all events with seq > 47 immediately
  3. Subscribe to live event emitter for this session
  4. As new events append, push them with their seq as `id:`
```

The `id:` field on each SSE message is the seq number. This is what `EventSource` automatically sends back as `Last-Event-ID` after a disconnect. You get resume for free.

### Heartbeats

Send a `: heartbeat\n\n` SSE comment every 15 seconds. This keeps Cloudflare's tunnel alive (it idles connections at ~100s) and lets the client detect a dead server faster than TCP would.

---

## 9. Token cap (your chosen alternative to compaction)

Per your decision: no compaction pipeline in v1. Instead:

```
On every turn boundary:
  estimatedTokens = countTokens(messageHistory)
  if estimatedTokens > model.contextWindow * 0.75:
    emit `status: warning, message: 'Approaching context limit'`
  if estimatedTokens > model.contextWindow * 0.90:
    block further user messages, surface "Start fresh" CTA
```

### `/new-session-with-context` command

A user-invoked slash command that:
1. Asks the LLM to produce a short brief from the current session's history (a single non-streaming call)
2. Creates a new session with the same repo, branch, and config
3. Prepends the brief as a system note: *"Continued from session {old_id}. Summary: ..."*
4. The old session is preserved untouched (you can scroll back)

This solves 80% of long-session pain for ~50 lines of code. Real compaction is a v1.5 task once you've seen which sessions actually fill the window.

### Token counting

Use `gpt-tokenizer` or `tiktoken` for an estimate. OpenRouter doesn't return reliable token usage per delta, so you estimate, and reconcile with the API's reported usage at end-of-turn. Estimate is fine — you only need to know "are we close?" not exact counts.

---

## 10. LLM provider layer

Stays on OpenRouter, but isolated behind one interface so you're not stuck:

```ts
interface LLMProvider {
  streamChat(req: ChatRequest): AsyncGenerator<LLMChunk, ChatUsage>;
  countTokens(messages: Message[]): number;
  capabilities(model: string): { contextWindow, supportsTools, supportsReasoning };
}
```

`OpenRouterProvider` implements this. Switching to direct Anthropic later (for prompt caching) means writing one new class, not refactoring the loop.

### Stream normalization

OpenRouter routes to many providers, each with quirks. Normalize them at the edge:

```ts
interface LLMChunk {
  type: 'text' | 'tool_call' | 'reasoning'
  text?: string
  reasoning?: string
  toolCall?: { id: string; name: string; arguments: string }
  model?: string    // actual model that served this response (from parsed.model)
}
```

- `delta.content` may be string or array — collapse to `chunk.text`
- Reasoning lives in `delta.reasoning` (DeepSeek) or `delta.reasoning_content` (others) — collapse both to `chunk.reasoning`
- Tool calls stream incrementally (args arrive as fragments) — accumulate them per `tool_call.id` and emit a single `tool_call` chunk when complete
- Some providers emit usage in the final SSE event, others don't — accept both
- **Model capture:** OpenRouter's SSE data lines include a `model` field at the top level (e.g. `{"model":"deepseek/deepseek-chat",...}`). This reflects the actual model that served the request — critical for detecting fallbacks. Parse it and attach to every yielded chunk.

This logic lives in `OpenRouterProvider`, not in the agent loop. The loop only sees normalized `LLMChunk`s.

### Model defaults and capabilities

The web UI defaults to `deepseek/deepseek-v4-flash` (128K context, tools, reasoning). Capabilities are looked up by exact match then prefix match — this lets model variants like `openai/gpt-4o:2024-08-06` inherit the base model's config. Unknown models fall back to a safe default (128K context, tools enabled, no reasoning).

The provider is the single point of model-specific knowledge. The agent loop only asks `capabilities(model)` and acts on the flags — it never hardcodes model names.

---

## 11. Frontend (TanStack Start)

```
apps/web/
  src/
    routes/
      index.tsx              ← session list / new session form (TanStack Query)
      sessions/$id.tsx       ← active chat UI (components inlined)
    state/
      events.ts              ← reducer: events[] → derived UI state
    hooks/
      useSessionStream.ts    ← EventSource wrapper, handles reconnect/replay
      usePocketSession.ts    ← main hook combining SSE + REST
      useRepoDropdown.ts     ← GitHub repo dropdown: query, filter, select
    lib/
      api.ts                 ← typed fetch wrapper for REST endpoints
```

Components (`StatusBadge`, `ToolCallCard`, `PermissionPrompt`) are co-located in `sessions/$id.tsx` — extraction into separate files is deferred until the component count warrants it.

### Two important UI principles

1. **Render from the event log, don't store derived state separately.** A `useReducer` over the event stream produces the message list. This is identical to how the server thinks — same mental model on both sides, fewer bugs.
2. **Optimistic user messages.** When you submit, render the message immediately with a pending state. Replace it with the server's authoritative version when the corresponding `user_message` event arrives. Same pattern for permission resolutions.

### Model display in message bubbles

Assistant message bubbles show the actual model name (from `ChatMessage.model`) in a monospace font below the bubble, alongside the timestamp. The reducer tracks `currentModel` through `assistant_text_delta` and `assistant_text_done` events, storing it on the finalized message.

When the actual model differs from the session's configured model, the display turns orange with a warning indicator and a tooltip showing the requested model vs. the fallback. The fallback check uses prefix matching (e.g. `deepseek/deepseek-chat-v3-0324` is not flagged as a fallback for `deepseek/deepseek-chat`) to avoid false positives from model variants.

### SSR caveat

TanStack Start does SSR. Your existing hydration concern (the `wsUrl` in `useEffect`) generalizes here: anything that depends on `EventSource` must be client-only, since `EventSource` doesn't exist on the server. Wrap session-stream-using components with a "client only" boundary or render a skeleton during SSR.

### Data fetching with TanStack Query

The homepage uses `@tanstack/react-query` for server-state management:

- **`useQuery` for reads** — `listSessions` and `fetchRepos` use `useQuery` with query keys `['sessions']` and `['github', 'repos']`. Results are cached, deduplicated, and refetched intelligently.
- **`useMutation` for writes** — `createSession` is a mutation that invalidates the sessions cache and navigates on success.
- **Error surfacing** — Both `useQuery` and `useMutation` expose `error` states that are rendered inline instead of silently swallowed.

This replaces raw `useEffect` + `fetch` calls that were error-prone and harder to test. Custom hooks like `useRepoDropdown` encapsulate query logic + local UI state, keeping the component surface area small.

---

## 12. Persistence and crash recovery

### What persists where

| Data | Where | Format | When written |
|---|---|---|---|
| Session events | `~/.pocket/sessions/{id}/events.jsonl` | JSONL | append, sync after every event |
| Session metadata | `~/.pocket/sessions/{id}/meta.json` | JSON | on status change, debounced |
| Permissions | `~/.pocket/sessions/{id}/permissions.json` | JSON | on rule change |
| Workspace | `~/.pocket/workspaces/{id}/` | git checkout | continuously by tools |
| User config | `~/.pocket/config.json` | JSON | on settings change |

### The append-and-fsync invariant

`events.jsonl` writes are append-only and `fsync`-ed before the runner emits the corresponding in-memory event. This means: **if the event is observable to anyone, it's already on disk.** A crash mid-turn loses at most the in-flight tool execution, not its history.

### Crash recovery

On server start:
1. Scan `~/.pocket/sessions/` for sessions with status `working` in `meta.json`
2. For each: mark status `interrupted`, append a `status` event explaining the crash, but do NOT auto-resume the agent loop
3. Client gets the `interrupted` status on its next SSE connect; UI shows a "Resume" button

Auto-resume is intentionally not v1 — you want to see what the agent was doing before deciding to continue.

### Cleanup

Workspace cleanup is intentionally conservative because you might come back to a session days later from a different device:

- **Never auto-cleaned**: workspaces for sessions with status `idle`, `working`, or `interrupted`
- **Auto-cleaned after 30 days**: workspaces for sessions with status `done` or `archived`
- **Always preserved**: session metadata and event log (small, no reason to delete)

Manual cleanup is available via the UI: per-session "delete workspace" (preserves chat history) and "delete session entirely" buttons.

The previous 7-day default was wrong for the "phone died, reopened a week later" case — it would have left the chat intact but stripped the repo, which is the worst possible state.

---

## 13. Auth and tunneling

### GitHub auth (unchanged from your current design, just specified properly)

- Server reads `GITHUB_TOKEN` from `.env` as default
- On session creation, if the client does not provide a token, the server falls back to `process.env.GITHUB_TOKEN`
- `git_push` falls back to `process.env.GITHUB_TOKEN` if the session has no token stored
- User can override per-session in the new-session form
- Token is **never** logged and never sent to the client after creation
- Git operations inject the token into the HTTPS URL (your existing pattern)
- `github_create_pr` uses Octokit with the same token

### Web auth

Handled by Cloudflare Access in front of the tunnel — the server itself has no auth code. Every request to the tunnel hits Cloudflare's identity check first; the server only sees authenticated requests. This is the right answer and means zero auth code in v1.

If you ever want to know *who* made a request (e.g. for multi-user later), Cloudflare Access injects a `Cf-Access-Authenticated-User-Email` header you can read server-side.

### Cloudflare tunnel config notes

- Disable buffering on your tunnel route — SSE needs immediate flushing (`Cache-Control: no-store` on the SSE response, plus tunnel-side `--no-tls-verify` is unrelated, just don't cache)
- The 100-second idle timeout is fine because of heartbeats
- WebSocket-specific tunnel config is irrelevant — you're not using them

---

## 14. Project layout

Single-process, single-port, served as one Node app. Monorepo uses pnpm workspaces:

```
pocket/
├── apps/
│   ├── web/               ← TanStack Start frontend (Vite dev, Netlify SSR)
│   └── server/            ← Fastify API + agent runtime (tsx in dev, tsc for prod)
├── packages/
│   ├── core/              ← shared types: Event, Tool, Message, Session (zod)
│   ├── agent/             ← AgentRunner, SessionManager, EventLog, PermissionGate,
│   │                         ProcessManager, TokenCounter, RingBuffer
│   ├── tools/             ← 20 tool implementations (one file per tool or group)
│   └── llm/               ← OpenRouterProvider, stream normalization
└── docs/
    ├── Architecture.md
    └── UserStories.md
```

`apps/server/` is a thin shell: it sets up Fastify, mounts routes, instantiates `SessionManager` from `packages/agent`, registers all tools from `packages/tools`, and runs the agent loop. All the meat is in `packages/`.

---

## 15. What's deliberately NOT in v1

These have a designed-in seam but no implementation:

- **Subagents** (`AgentRunner` is one class; v2 splits into Leader/Teammate)
- **Compaction pipeline** (token cap + new-session-with-context covers v1)
- **MCP servers** (the `Tool` interface is uniform enough that MCP tools can plug in identically — that's the seam)
- **Hooks** (no pre/post-tool hook fires; if you need them, the executor has clear injection points)
- **Voice / push notifications** (the event log makes both straightforward to add)
- **Multi-user** (single-user assumption is baked into auth and storage; don't accidentally couple it deeper)

---

## 16. Build order — v1 milestones (completed)

Each milestone was independently shippable and testable.

**M1 — Loop and persistence** ✓
- `core` types, event log writer, SessionManager, AgentRunner with the query loop
- One tool: `read_file`. No permissions yet.

**M2 — Web client** ✓
- TanStack Start app, session list, chat view
- SSE hook with reconnect/replay
- Composer, message rendering from event log

**M3 — Tools and permissions** ✓
- All v1 foreground tools (read, write, edit, grep, glob, web, git-ro, bash, plan, todos)
- Permission gate, conditional rules, "ask" UX in the client
- Bash matchers (allow/deny regex engine)
- Pending-approvals queue when reconnecting

**M4 — Git/GitHub integration** ✓
- Workspace cloning, branch/commit/push tools, PR creation
- Protected-branch check for `git_push`

**M5 — Background processes** ✓
- ProcessManager, ring buffers, five bash_background tools
- Foreground bash timeout (5 min)
- Session-wide cap (8 processes)

**M6 — Hardening** ✓
- Token cap (warn at 75%, block at 90%)
- Crash recovery on server restart (working → interrupted)
- 30-day workspace cleanup for done/archived sessions
- SSE heartbeats every 15s
- Per-turn message reconstruction (tool calls grouped by assistant response, not lumped)
- Duplicate write tool call detection (blocks identical calls after 3 repeats in one turn)

**M7 — Sandbox isolation** ✓
- Persistent Podman containers per session (`podman run -d --name pocket-{sessionId}`)
- `ensureContainer()` + `execInContainer()` replacing ephemeral `runInSandbox` for foreground bash
- Workspace setup (clone, eager sandbox init, bootstrap) on session creation, before first user message
- 30-minute idle timeout with auto-removal
- Default image: `docker.io/nikolaik/python-nodejs:python3.12-nodejs22`
- Background processes remain ephemeral (`--rm` per process)
- Session-scoped cleanup on delete, server shutdown via `killAllContainers()`
- Error events emitted to session on container failure (no silent fallback)

---

## 17. URL persistence (carried over from your old design)

The `?sessionId=...` query param behavior from your existing app is preserved:

- New session → URL updates to `/sessions/abc123` (TanStack Router file-based route)
- Reload → SSE reconnects with `Last-Event-ID`, full chat replays
- Two tabs on the same session URL → both render the same event log, both show the same state in real time
- Sessions list page reads from `~/.pocket/sessions/` directory, so anything ever created appears there

This is one of the things the event-log architecture makes free: deep linking, multi-tab, refresh-survives, "share a session URL with my other browser" all work without any special handling.

---

## 18. Resolved and open questions

Resolved during implementation:
1. **Bash allow rules** — regex matchers are in `PermissionGate.checkBashCommand()`. Rules are loaded from `~/.pocket/config.json`. When `sandboxImage` is set (always by default), all non-denied bash commands auto-allow — the container handles isolation. Without sandbox, the allow/deny/ask flow applies. The deny list always wins, even over sandbox and session-scoped allows. Default deny patterns (`DEFAULT_BASH_DENY`) include fork bombs, `rm -rf /`, and `sudo`.
2. **Process buffer size** — 4MB per stream per process. 8 processes × 2 streams × 4MB = 64MB worst case. Configurable via `processBufferSize` in config.
3. **Foreground bash timeout** — 5 minutes. On timeout, the process gets SIGTERM and the tool returns `{ timedOut: true }`.
4. **HTTP framework** — Fastify (not Express). Chosen for better SSE support and performance.
5. **Monorepo tool** — pnpm workspaces (not Nx). Simpler, fewer dependencies, already working.
6. **Message reconstruction from event log** — `buildMessages()` groups tool calls per `assistant_text_done` boundary so multi-turn sessions maintain correct LLM context. Earlier v1 lumped all tool calls onto the last assistant message, which corrupted history and caused loop stalls on flash models.
7. **Sandbox isolation** — foreground bash commands run in persistent Podman containers. `packages/tools/src/sandbox.ts` provides `ensureContainer()` (starts via `podman run -d --name pocket-{sessionId}`), `execInContainer()` (via `podman exec`), and `stopSandboxContainer()` for cleanup. 30-minute idle timeout. Default image: `docker.io/nikolaik/python-nodejs:python3.12-nodejs22` (via `DEFAULT_SANDBOX_IMAGE` constant). Background processes use ephemeral `--rm` containers. When sandbox is active, all bash commands auto-allow (except `DEFAULT_BASH_DENY` patterns) — the container handles isolation, not the permission gate. `sandboxImage` is validated at every entry point (config, API, session creation) to prevent bypass via null/empty string.

8. **Auto-bootstrap on clone** — after workspace is ready (cloned + sandbox started), `bootstrap_repo` tool automatically runs. It detects project type (node/python/rust/go), package manager (npm/pnpm/yarn/pip/cargo), scripts from package.json, config files (Vite, React, Next.js, Express, FastAPI, Django), and suggested dev server ports. It runs dependency install in the sandbox. Results are included in the agent's system prompt so the agent knows the exact commands for this repo instead of guessing.

Still open:
- **Web push** — deferred to v1.5 per §6.
- **Compaction** — token cap only in v1. Real compaction (compact_marker events, summary injection) is v1.5.
- **Background process UI** — process list panel in the chat view is implemented as a flat list; a richer panel with per-process controls is deferred.
