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
pnpm server     # Backend on :5173
pnpm web:dev    # Frontend on :3000
```

Access: http://localhost:3000/pocket

### Deployment with Cloudflare Tunnel

If using a Cloudflare Tunnel (e.g., `bolt.clvg.uk`):
1. Point your tunnel's public hostname to `http://localhost:3000`.
2. The frontend Vite server is configured to proxy `/ws` to port `5173` for the backend.
3. Ensure `apps/web/vite.config.ts` includes your domain in `allowedHosts` and `hmr.host`.

## Use

1. Paste GitHub repo URL
2. Enter task description
3. (Optional) Provide a GitHub Token override if your global token is expired or you need different permissions
4. Clone → Create Branch
4. Chat with agent
5. PR created to `pocket` branch

## Test

```bash
pnpm vitest run server/__tests__/          # Server (70 tests)
cd apps/web && pnpm vitest run src/__tests__/  # Web (17 tests)
```

## Docs

| Document | Description |
|----------|-------------|
| [Overview](docs/Overview.md) | Quick reference |
| [Architecture](docs/Architecture.md) | Technical details |
| [Tunnel Setup](docs/Tunnel.md) | Remote access |


### ROADMAP
- [ ] check if it can do web search
- [ ] add connection status in the main page too? How is it checked to begin with?
- [ ] use image recognition as well, inspect visual changes just like Jules. Run tests and build too if there are any in the repo
