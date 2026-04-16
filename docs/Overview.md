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
2. Clone Repo → Create Branch
3. Chat with agent → PR created to `pocket` branch

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
