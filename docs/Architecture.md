# Architecture

## Networking & Deployment

### Local Development
- **Frontend (Vite/TanStack Start):** Runs on port `3000`.
- **Backend (Express/WS):** Runs on port `5173`.
- **Proxy:** Vite proxies `/ws` requests to `localhost:5173`.

### Cloudflare Tunnel Setup
To expose the application securely:
1. **Tunnel Configuration:** Map your public domain (e.g., `bolt.clvg.uk`) to `http://localhost:3000`.
2. **Vite Security:** 
   - Add the domain to `server.allowedHosts` in `vite.config.ts`.
   - Set `server.hmr.host` to your domain to allow Hot Module Replacement.
3. **Secure WebSockets:** The application automatically detects the protocol (`ws:` vs `wss:`) based on `window.location.protocol` to ensure compatibility with Cloudflare's HTTPS.

## Layers

```
Frontend (React) → WebSocket Server → Tools (Git, Files, GitHub)
```

## Frontend

`apps/web/src/routes/pocket.tsx` - Chat UI
`apps/web/src/hooks/usePocket.ts` - WebSocket client

### SSR & Hydration

The app uses TanStack Start with SSR. To prevent hydration mismatches:

- `usePocket` only connects to WebSocket when `wsUrl` is provided
- `wsUrl` is set in a `useEffect` (runs after hydration), ensuring server and client render with identical initial state
- This prevents the "A tree hydrated but some attributes didn't match" React warning

## Backend

`server/index.js` - WebSocket + Express server
`server/sessions.js` - In-memory session store
`server/llm.js` - OpenRouter client

### LLM Client (llm.js)

The `streamChat` function handles OpenRouter's streaming API with tool calling:

- Supports both string and array formats for `delta.content` (various LLM providers return different formats)
- Extracts reasoning content from `delta.reasoning` (DeepSeek) or `delta.reasoning_content` (other providers) and forwards it via `onReasoning`
- Calls `onStartTurn` before each API request (including multi-turn loops after tool execution)
- Accumulates tool arguments across streaming chunks
- Handles `delta.tool_calls` format for tool call streaming
- Calls `onChunk` for text tokens and `onToolCall` for tool use (start/complete)
- Multi-turn tool execution: when LLM requests a tool, executes it via `executeTool` callback and feeds result back to LLM
- Calls `onRaw` with raw parsed data for debugging

```typescript
streamChat(
  messages: {role: string, content: string}[],
  onChunk: (text: string) => void,
  onToolCall: (toolCall: {name, arguments, status, result?}) => void,
  executeTool: (toolName: string, args: object) => Promise<object>,
  onRaw?: (data: object) => void,
  onStartTurn?: () => void,
  onReasoning?: (text: string) => void,
  model?: string
)
```

**buildSystemMessage** creates the system prompt with repo context:

```typescript
buildSystemMessage(
  branchName: string,
  taskDescription: string,
  repoName: string,
  localPath: string
)
```

## Tools

| Tool | File | Description |
|------|------|-------------|
| read_file | tools/file.js | Read repo files |
| write_file | tools/file.js | Write repo files |
| run_command | tools/command.js | Execute shell |
| git_clone | tools/git.js | Clone GitHub repo |
| git_create_branch | tools/git.js | Create branch |
| git_commit | tools/git.js | Commit changes |
| git_push | tools/git.js | Push to remote |
| github_create_pr | tools/github.js | Create PR |

### Temp Directory

Repositories are cloned to `{os.tmpdir()}/pocket` (e.g., `/tmp/pocket` on Linux, `/var/folders/.../T/pocket` on macOS).

- **Cross-platform**: Uses `os.tmpdir()` automatically
- **Automatic cleanup**: Directories older than 7 days are removed on server startup

## WebSocket Protocol

Client → Server: `create_session`, `resume_session`, `list_sessions`, `clone`, `create_branch`, `chat`, `commit`, `create_pr`
Server → Client: `session_created`, `session_resumed`, `sessions_list`, `status`, `thinking_start`, `reasoning`, `token`, `tool_start`, `tool_result`, `debug`, `error`

**Note**: `status` messages include a `message` field for feedback (e.g., "Committed and pushed!", "PR created!"). `debug` messages contain raw LLM response data for debugging.

**Loading State**: The frontend derives `isLoading` from status messages. When status is `cloning`, `creating_branch`, or `working`, the UI shows a loading indicator. Terminal states (`ready`, `done`, `error`) clear the loading indicator.

**Thinking Flow**: When a `chat` message is sent, the server emits `thinking_start` before the first OpenRouter request. If the model supports reasoning, `reasoning` chunks stream in real time. Once content tokens arrive (`token`), the frontend switches from the generic "Thinking..." indicator to displaying the actual response.

## Session

```js
{
  id, repoUrl, task, githubToken, localPath, branchName,
  history: [{role, content}],
  status, // created|cloning|cloned|creating_branch|ready|working|done|error
  createdAt,
  lastActivity
}
```

### Persistence & Background Execution
Pocket supports long-lived processes. Unlike typical chat applications where the process might stop if the connection is lost, Pocket's agent continues to execute tasks on the server.
- **WebSocket Disconnect**: Closing the browser tab does *not* delete the session workspace or stop the agent.
- **Message Routing**: The backend tracks active sessions and routes LLM updates to the most recently connected client for that session.
- **History Sync**: When a client resumes a session, they receive the full chat history, including any work the agent completed while the client was away.

## Authentication

Pocket supports automated GitHub authentication via Personal Access Tokens (PATs).

1. **Default:** Uses `GITHUB_TOKEN` from the server's `.env` file.
2. **Override:** Users can provide a specific token when starting a new session in the UI.

### Git Operations
For `git clone` and `git push`, Pocket injects the token directly into the HTTPS URL:
`https://<token>@github.com/owner/repo.git`

This ensures all operations are non-interactive and bypasses the need for SSH keys in most server environments.

### GitHub API
Tool-based operations like `github_create_pr` use the token to initialize an `Octokit` instance.

## URL Strategy

The frontend persists the current session ID in the URL using the `sessionId` query parameter:
- `http://localhost:3000/pocket?sessionId=sess_abc123`

This allows:
1. **Persistence**: Refreshing the page doesn't lose the active session.
2. **Deep Linking**: Sharing a session URL (in a local network) allows another tab to resume it.

## Branch Strategy

```
main → pocket (mirror) → pocket/{timestamp}-{slug} (agent branch) → PR to pocket
```

## Automatic Flow

1. **Branch Creation**: When a branch is created via `create_branch`, it is automatically pushed to origin
2. **Post-Chat Auto-Commit**: After chat completes, any uncommitted changes are automatically committed and pushed
3. **Manual Controls**: "Commit" and "Create PR" buttons allow manual control over when to commit and create PRs

## Frontend UI

The chat interface provides:
- **Message input**: Type messages to chat with the agent
- **Thinking indicator**: Animated "Thinking..." badge shown while the LLM is processing, before any tokens arrive
- **Reasoning panel**: For reasoning-capable models (DeepSeek-R1, Claude 3.7 Sonnet, etc.), the model's internal reasoning is streamed and displayed above the final response in the assistant's message bubble
- **Commit button**: Manually commits and pushes current changes
- **Create PR button**: Creates a pull request to the `pocket` branch
- **View PR link**: Appears after a PR is created
