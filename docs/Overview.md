# Pocket

Self-hosted autonomous coding agent. Chat with an AI to work on GitHub repos.

## Documentation

| Document | Purpose |
|---------|---------|
| [Architecture](Architecture.md) | Technical architecture, layers, API |
| [User Stories](UserStories.md) | Use cases |
| [Tunnel Setup](Tunnel.md) | Cloudflare tunnel for remote access |
| [README](../README.md) | Installation, quick start |

## How it works

1. Paste repo URL → Start Session
2. Clone Repo → Create Branch (branch is pushed to origin automatically)
3. Chat with agent → Changes are auto-committed after each response
4. Use "Commit" to manually commit anytime, "Create PR" to create a pull request
5. **Session History**: Revisit past sessions from the "Session History" list below the form.
6. **URL Persistence**: Reloading the page keeps your current session active thanks to the `sessionId` URL parameter.

## Architecture

```
Browser → WebSocket Server → OpenRouter (LLM)
                    ↓
            Git + Filesystem + GitHub API
```

## Tech Stack

- **Frontend:** React (TanStack Router)
- **Backend:** Node.js + Express + WebSocket
- **LLM:** OpenRouter
- **GitHub:** Octokit + Git CLI
