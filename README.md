# Pocket

A self-hosted coding agent you drive from your phone. The server runs on your home machine and exposes a tunneled web client. The agent works on your repos, opens PRs, and keeps going while your phone is locked.

## Architecture

```
pocket/
├── apps/
│   ├── web/          ← TanStack Start frontend (EventSource + SSE)
│   └── server/       ← Fastify API + agent runtime
├── packages/
│   ├── core/         ← Shared types (Event, Tool, Message, Session, etc.)
│   ├── llm/          ← OpenRouter provider with stream normalization
│   ├── tools/        ← 20 tool implementations (file, git, bash, web, background)
│   └── agent/        ← AgentRunner, SessionManager, EventLog, PermissionGate,
│                       ProcessManager, TokenCounter
└── docs/
```

**Single process, single port.** The server serves both the API and the web client. SSE for server→client, REST for client→server. No WebSockets, no polling.

### Key principles

- **The server is the source of truth.** Closing the tab never stops the agent.
- **Append-only event log.** Sessions are JSONL on disk. Reconnection is replay, not reconnect.
- **Permissions over prompts.** Sensible auto-allow defaults so the agent keeps going.
- **One transport, one protocol.** SSE + REST only.

## Install

```bash
pnpm install
cp .env.example .env
# Edit .env: set OPENROUTER_API_KEY and GITHUB_TOKEN
```

## Run

```bash
pnpm dev                  # Server + web (concurrently)
# Or individually:
pnpm server:dev           # Server on :5173 (Fastify)
pnpm web:dev              # Frontend on :3000 (Vite)
```

Access: `http://localhost:3000`

### Cloudflare Tunnel

Point your tunnel to `http://localhost:3000`. SSE heartbeats every 15s keep the tunnel alive. Vite proxies `/api` requests to the server on `:5173`.

## Sandbox isolation

Bash commands run in persistent Podman containers per session instead of directly on the host. Each session gets one container that stays alive for the session lifetime — tool caches (npm packages, pip, cargo) survive between commands.

```
Session starts → container starts (eager init, before agent loop)
Agent calls bash({ command: "tsc --noEmit" })
  → podman exec pocket-{sessionId} sh -c "tsc --noEmit"
Agent calls bash again → same container, tools cached → instant
30 min idle → container auto-removed
Session ends → container cleaned up
```

**Requirements:** Podman (pre-installed on Fedora, `brew install podman` on macOS).

**Default image:** `nikolaik/python-nodejs:python3.12-nodejs22`. Override per session or globally:

```json
// ~/.pocket/config.json
{ "defaultSandboxImage": "python:3.12-slim" }
```

```bash
# Per-session override on creation
POST /api/sessions
{ "sandboxImage": "rust:1-alpine" }
```

Common images: `node:22-alpine`, `python:3.12-slim`, `rust:1-alpine`, `nikolaik/python-nodejs:python3.12-nodejs22` (default, JS + Python).

If Podman isn't installed, container init emits a warning but does not block — bash commands return errors per-call so the agent and user see them.

**Background processes** (`bash_background`) still use ephemeral containers (`podman run --rm`) — one per process, destroyed on exit.

## Test

```bash
pnpm -r test              # All 203 tests across 6 packages
# or individually:
pnpm --filter @pocket/agent test      # 80 tests
pnpm --filter @pocket/tools test      # 68 tests
pnpm --filter web test                # 22 tests
pnpm --filter @pocket/server test     # 13 tests
pnpm --filter @pocket/core test       #  9 tests
pnpm --filter @pocket/llm test        # 11 tests
```

## Use

1. Open the app, paste a GitHub repo URL and task description
2. On your first message, the agent clones the repo into `~/.pocket/workspaces/{id}/repo`, creates a branch (`pocket/{timestamp}-{slug}`), and starts working
3. Chat with the agent — it reads files, makes changes, commits, and pushes
4. Use "Create PR" when ready
5. Reopen the tab any time — session history is preserved

### Session persistence

Sessions live in `~/.pocket/sessions/{id}/`:

- `meta.json` — repo, task, model, branch, status, timestamps
- `events.jsonl` — append-only event log (the source of truth)
- `permissions.json` — session-scoped permission grants

Workspaces live in `~/.pocket/workspaces/{id}/`. Workspaces for `done`/`archived` sessions are auto-cleaned after 30 days. Session metadata is never deleted.

### Permissions

Read-only tools auto-allow. Writes inside the workspace auto-allow. Bash is gate by regex matchers in `~/.pocket/config.json`. Unknown commands require approval. The deny list (`rm -rf /`, `sudo`) cannot be overridden.

### Crash recovery

On restart, sessions that were `working` are marked `interrupted`. The client shows a "Resume" button. The agent never auto-resumes — you decide.

## Docs

| Document                             | Description           |
| ------------------------------------ | --------------------- |
| [Architecture](docs/Architecture.md) | Full technical design |
| [User Stories](docs/UserStories.md)  | User flows            |

## Tool inventory (v1)

| Tool                                  | Read-only | Default      | Notes                               |
| ------------------------------------- | --------- | ------------ | ----------------------------------- |
| `read_file`                           | ✓         | allow        | Path bound to workspace             |
| `list_files`                          | ✓         | allow        | Extension filter                    |
| `grep`                                | ✓         | allow        | ripgrep fallback                    |
| `glob`                                | ✓         | allow        | File pattern matching               |
| `web_fetch`                           | ✓         | allow        | Capped at 100KB                     |
| `web_search`                          | ✓         | allow        | OpenRouter-powered                  |
| `git_status` / `git_log` / `git_diff` | ✓         | allow        | Read-only git                       |
| `write_file`                          | ✗         | conditional  | Allow in workspace, ask outside     |
| `edit_file`                           | ✗         | conditional  | String-replace, enforces uniqueness |
| `git_create_branch`                   | ✗         | allow        | `pocket/{timestamp}-{slug}`         |
| `git_commit`                          | ✗         | allow        | Stages all changes                  |
| `git_push`                            | ✗         | conditional  | Protected branch check              |
| `github_create_pr`                    | ✗         | allow        | PR to `main` base branch            |
| `bash`                                | ✗         | rule-matched | Regex gate, 5-min timeout, sandboxed via Podman |
| `bash_background`                     | ✗         | rule-matched | Spawn daemon process, sandboxed via Podman |
| `bash_read_output`                    | ✓         | allow        | since_last_read / tail / all        |
| `bash_send_input`                     | ✗         | ask          | Write to process stdin              |
| `bash_kill`                           | ✗         | allow        | SIGTERM → SIGKILL                   |
| `list_processes`                      | ✓         | allow        | List background processes           |
| `plan`                                | ✗         | allow        | Agent scratchpad                    |
| `todos_write`                         | ✗         | allow        | Task tracking                       |

## TODO - ROADMAP

- [x] better virtualization
- [ ] pre-set up repo with instructions in `README.md`
- [ ] add wrap in my input chat so I can see three lines of text. we can make it scrollable, is this a good practice?
- [ ] Make sure we add a "prompt improver" where we can click a button or something and then the agent will try to improve the prompt, it will ask questions and try to improve the prompt -> Then send the new prompt to our main chat. When it improves the prompt it must not pollute the original LLM's context, but it also should have all the context.
- [ ] Take inspiration from Bolt.diy and https://github.com/Gitlawb/openclaude
