# Pocket

Self-hosted autonomous coding agent. Chat with an AI to work on GitHub repos.

## Install

```bash
pnpm install
cp .env.example .env
# Edit .env with OPENROUTER_API_KEY and GITHUB_TOKEN
```

## Run

```bash
pnpm dev        # Both server + frontend
# Or:
pnpm server     # Backend on :8080
pnpm web:dev    # Frontend on :3000
```

Access: http://localhost:3000/pocket

## Use

1. Paste GitHub repo URL
2. Enter task description
3. Clone → Create Branch
4. Chat with agent
5. PR created to `pocket` branch

## Test

```bash
pnpm --filter pocket-server test   # Server (41 tests)
pnpm --filter web test            # Web (4 tests)
```

## Docs

| Document | Description |
|----------|-------------|
| [Overview](docs/Overview.md) | Quick reference |
| [Architecture](docs/Architecture.md) | Technical details |
| [Tunnel Setup](docs/Tunnel.md) | Remote access |
