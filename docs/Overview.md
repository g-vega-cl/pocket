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
3. Chat with agent → Changes committed, pushed, and PR created to `pocket` branch
4. Continue chatting or start a new session

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
