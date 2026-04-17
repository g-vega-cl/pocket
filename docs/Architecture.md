# Architecture

## Layers

```
Frontend (React) → WebSocket Server → Tools (Git, Files, GitHub)
```

## Frontend

`apps/web/src/routes/pocket.tsx` - Chat UI
`apps/web/src/hooks/usePocket.ts` - WebSocket client

## Backend

`server/index.js` - WebSocket + Express server
`server/sessions.js` - In-memory session store
`server/llm.js` - OpenRouter client

### LLM Client (llm.js)

The `streamChat` function handles OpenRouter's streaming API with tool calling:

- Supports both string and array formats for `delta.content` (various LLM providers return different formats)
- Accumulates tool arguments across streaming chunks
- Calls `onChunk` for text tokens and `onToolCall` for tool use (start/complete)

```typescript
streamChat(
  messages: {role: string, content: string}[],
  onChunk: (text: string) => void,
  onToolCall: (toolCall: {name, arguments, status}) => void,
  model?: string
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

## WebSocket Protocol

Client → Server: `create_session`, `resume_session`, `clone`, `create_branch`, `chat`
Server → Client: `session_created`, `status`, `token`, `tool_start`, `tool_result`, `done`, `error`

**Note**: `done` message includes `prUrl` when a PR was created.

## Session

```js
{
  id, repoUrl, task, localPath, branchName,
  history: [{role, content}],
  status // created|cloning|cloned|creating_branch|ready|working|done|error
}
```

## Branch Strategy

```
main → pocket (mirror) → pocket/{timestamp}-{slug} (agent branch) → PR to pocket
```

## Automatic Flow

1. **Branch Creation**: When a branch is created via `create_branch`, it is automatically pushed to origin
2. **Post-Chat**: After chat completes, any uncommitted changes are automatically committed, pushed, and a PR is created to the `pocket` branch
