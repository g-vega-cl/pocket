# Architecture

## Error Handling

The server implements multi-layered error handling to prevent crashes:

### 1. Global Exception Handlers (`server/index.js`)
- **uncaughtException**: Catches fatal uncaught exceptions, logs with stack trace, attempts graceful shutdown (10s timeout), then exits with code 1
- **unhandledRejection**: Catches unhandled promise rejections, logs error but doesn't crash (recovery mode)

### 2. Tool Function Resilience (`server/tools/`)
- **git.js**: All git operations (clone, init, branch, commit, push, status) wrapped in try-catch with proper error logging
- **file.js**: File operations return errors instead of throwing, listFiles returns empty array on error
- **command.js**: Commands return error objects with success=false instead of throwing

### 3. Auto-Restart Mechanism
- Parent process spawns child Node process
- Monitors for non-zero exit codes
- Auto-restarts after 3 seconds if crashed
- Uses `POCKET_CHILD` env var to prevent infinite spawn loops

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

`server/index.js` - Express server (polling-based)
`server/sessions.js` - In-memory session store with disk persistence
`server/llm.js` - OpenRouter client

**Note**: Pocket uses a polling-based architecture for real-time updates (see [POLLING-MIGRATION.md](POLLING-MIGRATION.md) for details). No WebSocket or SSE connections are used.

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

**System Prompt Structure**:
- **Interaction Rules**: Defines when to use tools vs. respond naturally
- **Available Tools**: Lists all available tools with descriptions
- **Repository Context**: Includes repo name, branch, task, and local path

**Important**: The system prompt includes explicit rules to prevent infinite tool-call loops:
1. Greetings/conversation: Respond naturally without using tools
2. Repository questions: Explore using tools ONCE, then answer based on results
3. Do NOT loop - after exploring, answer the user's question directly

## Tools

| Tool | File | Description |
|------|------|-------------|
| read_file | tools/file.js | Read repo files |
| write_file | tools/file.js | Write repo files |
| run_command | tools/command.js | Execute shell |
| git_clone | tools/git.js | Clone GitHub repo (5min timeout) |
| git_create_branch | tools/git.js | Create branch |
| git_commit | tools/git.js | Commit changes |
| git_push | tools/git.js | Push to remote |
| github_create_pr | tools/github.js | Create PR |

### Temp Directory

Repositories are cloned to `{os.tmpdir()}/pocket` (e.g., `/tmp/pocket` on Linux, `/var/folders/.../T/pocket` on macOS).

- **Cross-platform**: Uses `os.tmpdir()` automatically
- **Automatic cleanup**: Directories older than 7 days are removed on server startup

## API Protocol

Pocket uses a polling-based architecture with REST API for real-time updates.

### Client → Server (REST API)
- `POST /api/sessions` - Create new session
- `POST /api/sessions/local` - Create local session
- `GET /api/sessions/:sessionId` - Get session state (polling endpoint)
- `POST /api/sessions/:sessionId/clone` - Clone repository
- `POST /api/sessions/:sessionId/create_branch` - Create branch
- `POST /api/sessions/:sessionId/chat` - Send message to agent
- `POST /api/sessions/:sessionId/commit` - Commit changes
- `POST /api/sessions/:sessionId/create_pr` - Create pull request
- `POST /api/sessions/:sessionId/permission` - Respond to permission request

### Server → Client (Polling Response)
The `/api/sessions/:sessionId` endpoint returns the full session state:
- `session_created` - New session created
- `session_resumed` - Session loaded from disk
- `session_data` - Session state update
- `sessions_list` - List of all sessions
- `status` - Session status change (includes `message` field for feedback)
- `user_message` - User message added to history
- `tool_result` - Tool execution result
- `error` - Error message
- `permission_request` - Permission request for tool execution
- `aborted` - Session aborted

### Debug Messages
Server sends `debug` messages with raw LLM response data for debugging:
- `llm_delta` - Raw delta from LLM stream
- `llm_complete` - Completion details after each turn

### Loading State
The frontend derives `isLoading` from status messages. When status is `cloning`, `creating_branch`, or `working`, the UI shows a loading indicator. Terminal states (`ready`, `done`, `error`) clear the loading indicator.

### Error Handling
- **HTTP Errors**: API requests that return non-2xx status codes are caught and displayed with the status code and error message (e.g., `Error 429: Too Many Requests`)
- **Network Errors**: Failed network requests are caught and displayed with the error message
- **Server Errors**: Server-sent `error` messages are displayed in the UI with the error text

### Background Sync
Pocket uses polling to ensure you always see the latest status:
- **Polling Interval**: Every 5 seconds (5000ms) when a session is active
- **Endpoint**: `GET /api/sessions/:sessionId`
- **Response**: Full session state including history, status, and metadata
- **On visibility change**: When returning to the tab, immediately fetches latest status
- **Visual indicator**: Shows "Syncing" spinner + last sync time

This ensures you always see the latest state without complex real-time infrastructure.

### Thinking Flow
When a `chat` message is sent:
1. User message is added to history
2. Server processes the message via `streamChat()`
3. LLM may make tool calls or generate text
4. After completion, session history is updated and persisted
5. Client sees updated history on next poll (within 5 seconds)

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
