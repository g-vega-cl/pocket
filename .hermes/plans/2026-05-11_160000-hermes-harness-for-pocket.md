# Plan: Hermes Agent as a Quality Harness for Pocket

**Created:** 2026-05-11
**Goal:** Use Hermes Agent's self-improvement infrastructure to continuously improve Pocket's code quality and agent longevity.

---

## 1. Analysis: What each system brings

### Pocket (what you built)

| Capability | Status |
|---|---|
| Coding agent loop (Node.js, Fastify + TanStack Start) | v1 done |
| OpenRouter LLM integration with streaming | done |
| 20+ tools (file, git, bash, web, plan, PRs) | done |
| Permission system (allow/deny/ask matchers) | done |
| Sandbox isolation (Podman containers) | done |
| Append-only event log with SSE replay | done |
| Mobile-first web client | done |
| Prompt improver (separate LLM with read-only tools) | done |
| Subagents | **not in v1** |
| Scheduled tasks (cron) | **not in v1** |
| Cross-session memory | **not in v1** |
| Self-improving skills | **not in v1** |
| Compaction pipeline | **not in v1** |
| Multi-agent coordination | **not in v1** |

### Hermes Agent (what you're using right now)

| Capability | Status |
|---|---|
| Skills — self-improving procedural memory (lessons, workflows, pitfalls) | built-in |
| Memory — persistent cross-session facts (preferences, project structure, conventions) | built-in |
| Session search — recall past work without repeating context | built-in |
| Curator — automatic skill lifecycle (track usage, archive stale, back up) | built-in |
| Cron jobs — scheduled autonomous runs (nightly reviews, dependency audits) | built-in |
| Delegate tasks — parallel subagents for independent workstreams | built-in |
| Multi-agent spawning — fully independent Hermes processes via tmux or one-shot | built-in |
| Context compression — token-aware compaction for long sessions | built-in |
| Multi-provider — 20+ providers with credential pooling and fallbacks | built-in |
| Gateway — the same agent on Telegram, Discord, Slack, etc. | built-in |

**Key insight:** Hermes Agent can work ON Pocket. It can review Pocket's source code, run its tests, fix bugs, file PRs, and accumulate knowledge about Pocket that makes every future session more effective.

---

## 2. Strategy: Hermes as Pocket's Meta-Agent

```
┌─────────────────────────────────────────────────────────────┐
│                    Hermes Agent (You)                        │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ Skills about     │  │ Memory about     │                │
│  │ Pocket patterns, │  │ Pocket structure,│  Accumulates   │
│  │ pitfalls, tests  │  │ conventions,     │  over time     │
│  │                  │  │ tool quirks      │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Cron Jobs (scheduled)                                │   │
│  │  • Nightly: run Pocket tests, report failures        │   │
│  │  • Weekly: code review / lint / typecheck audit      │   │
│  │  • On PR: review Pocket PRs for quality              │   │
│  │  • Monthly: dependency audit, architecture review    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Delegate Tasks (parallel, on-demand)                 │   │
│  │  • Run test suite on Pocket                          │   │
│  │  • Run typecheck + lint                              │   │
│  │  • Search for code smells                            │   │
│  │  • Verify Architecture.md matches implementation     │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│              Works on /Users/cesarvega/                     │
│              Documents/p-code/pocket/                       │
└─────────────────────────────────────────────────────────────┘
```

The harness is not something you build INTO Pocket. It's something Hermes does TO Pocket — from the outside, using its own tools (terminal, file, git, web) to inspect, test, and improve Pocket's codebase.

---

## 3. Concrete mechanisms

### 3.1 Skills — Knowledge That Compounds

Every time Hermes works on Pocket and discovers something, it saves it as a skill. These accumulate:

```
~/.hermes/skills/
├── pocket-project/
│   ├── SKILL.md             ← project conventions, file layout, common patterns
│   ├── references/
│   │   ├── architecture.md  ← key architecture notes
│   │   └── test-patterns.md ← how to write Pocket tests
│   └── scripts/
│       └── run-all-tests.sh ← one command to run everything
```

When you later say "Hermes, fix the session-reconnect bug in Pocket," Hermes loads the `pocket-project` skill automatically and already knows:
- Pocket uses pnpm workspaces, not npm
- The test framework is vitest with tsx
- The agent loop is in `packages/agent/src/agent-runner.ts`
- Tools are in `packages/tools/src/`
- The SSE reconnect logic is in `useSessionStream.ts`
- Common pitfalls (e.g., React 19 `<details>` hydration quirk with `suppressHydrationWarning`)

This is the core self-improvement loop: each interaction makes the next one faster.

### 3.2 Memory — Context That Survives

```
Memory entries (auto-saved):
  - Pocket uses pnpm workspaces (pnpm test, not npm test)
  - OpenRouter API key is configured
  - Node version must be >= 22 for Pocket
  - Pocket server runs on port 3000
  - Cloudflare tunnel is configured at pocket.example.com
  - Sandbox uses Podman, not Docker
  - TanStack Start SSR caveats: chat route uses ssr:false
```

These facts persist across sessions. When you resume work on Pocket next week, Hermes doesn't need to rediscover them.

### 3.3 Cron Jobs — Autonomous Quality Guard

```bash
# Job 1: Nightly test run
hermes cron create '0 3 * * *' \
  --prompt "Run the full test suite for Pocket at /Users/cesarvega/Documents/p-code/pocket.
    Use pnpm test. Report any failures with exact error messages and file paths.
    If tests pass, report 'All tests passing'.
    Do NOT attempt to fix failures — just report them."

# Job 2: Weekly code quality audit
hermes cron create '0 9 * * 1' \
  --prompt "Audit Pocket's code quality at /Users/cesarvega/Documents/p-code/pocket.
    1. Run pnpm typecheck (if configured)
    2. Check for TODOs/FIXMEs in source files
    3. Verify test coverage on changed files
    4. Check if Architecture.md is consistent with actual code structure
    5. Report findings as a summary"

# Job 3: Dependency check (monthly)
hermes cron create '0 9 1 * *' \
  --prompt "Check Pocket's dependencies for known vulnerabilities.
    Run pnpm audit in /Users/cesarvega/Documents/p-code/pocket.
    Report any critical or high severity issues."
```

### 3.4 Delegate Tasks — Parallel Quality Checks

When actively working on Pocket, Hermes can run parallel quality checks:

```python
# Conceptual flow — Hermes does this via delegate_task
delegate_task(tasks=[
  {
    "goal": "Run pnpm test in /Users/cesarvega/Documents/p-code/pocket and report results",
    "context": "Pocket is a Node.js monorepo using pnpm workspaces",
    "toolsets": ["terminal"]
  },
  {
    "goal": "Run pnpm typecheck in /Users/cesarvega/Documents/p-code/pocket",
    "context": "TypeScript project, run with pnpm typecheck if script exists",
    "toolsets": ["terminal"]
  },
  {
    "goal": "Search for code smells in Pocket source: unused imports, console.log left in production code, hardcoded credentials",
    "context": "Search in /Users/cesarvega/Documents/p-code/pocket/apps and /Users/cesarvega/Documents/p-code/pocket/packages. Exclude node_modules and .git.",
    "toolsets": ["terminal", "file"]
  }
])
```

### 3.5 Session Search — No Repeating Context

When you say "remember that SSE bug we fixed last month?", Hermes uses `session_search` to find the exact session where it was fixed, retrieves the approach, and doesn't need you to re-explain.

---

## 4. Implementation steps (execution plan)

### Phase 1: Foundation (today, ~30 min)

**Step 1:** Save a `pocket-project` skill with Pocket's conventions.

Load the project structure, test commands, and key conventions into a skill so every future Pocket session is bootstrapped with context.

**Step 2:** Save durable memory entries.

Key facts about Pocket that Hermes should never need to rediscover: build system, test commands, project layout, tooling choices, known quirks.

**Step 3:** Verify Pocket's test suite runs from Hermes.

```bash
cd /Users/cesarvega/Documents/p-code/pocket && pnpm test
```

### Phase 2: Automated Quality (this week, ~1 hr)

**Step 4:** Create the nightly test cron job.

A scheduled job that runs Pocket's test suite and reports results. Starts as report-only (no auto-fix).

**Step 5:** Create the weekly code quality audit cron job.

Scheduled review of TODOs, Architecture.md consistency, and code smells.

**Step 6:** Establish the "fix it" workflow.

When a cron job reports a failure, you say "Hermes, fix it." Hermes loads the `pocket-project` skill, already knows the codebase, and fixes the issue efficiently.

### Phase 3: Deep Integration (as needed)

**Step 7:** Parallel quality checks via delegate_task.

When doing significant Pocket work, run tests + typecheck + lint in parallel before showing results.

**Step 8:** PR review automation.

When you open a Pocket PR, Hermes can review it — checking for consistency with Architecture.md, verifying test coverage, and flagging deviations from established patterns.

**Step 9:** Architecture drift detection.

Cron job that compares Architecture.md to actual code structure and flags misalignments.

---

## 5. What this does NOT require

You do **not** need to:
- Modify Pocket's code at all
- Add subagents to Pocket's v1 architecture
- Build a compaction pipeline into Pocket
- Change Pocket's LLM provider or tools
- Deploy any new infrastructure

Hermes operates on Pocket from the outside — using `terminal`, `file`, `git`, and `web` tools to interact with Pocket's repository just like it would any other project.

---

## 6. Expected outcomes

| Metric | Before (Pocket alone) | After (Pocket + Hermes harness) |
|---|---|---|
| **Test awareness** | Manual: you run tests when you remember | Automated: nightly runs report failures |
| **Bug reintroduction** | Easy: no persistent memory of past fixes | Hard: skills capture fix patterns; memory tracks known issues |
| **Context cost** | High: every session rediscovers Pocket's structure | Low: skill + memory bootstrap each session |
| **Code quality visibility** | None: no automated audit | Weekly: TODOs, drift, and smells surfaced |
| **Session longevity** | Capped by token window (128K) + no compaction | Hermes sessions have compression; Pocket sessions remain bounded but Hermes can resume longer work across sessions |
| **Knowledge accumulation** | Zero: each Pocket agent session is isolated | Compound: skills and memory grow with every interaction |

---

## 7. Open questions

1. **Should Pocket's agent loop itself be modified?** Probably not in v1 — Hermes as external harness already provides 80% of the value. The remaining 20% (in-agent skills, in-agent memory) can be Pocket v2 features.

2. **How to handle Pocket server restart?** The nightly cron job should check if Pocket's server is running before attempting tests. If Pocket uses a dev server, the cron job can start it temporarily.

3. **How to avoid Hermes and Pocket competing for OpenRouter credits?** Both use the same API key. The cron jobs use minimal tokens (single-turn reports). Batch scheduling avoids overlap with active development sessions.

4. **Should Pocket itself be run as a Hermes cron job?** Interesting idea — Pocket's server could be monitored by Hermes, auto-restarted on crash, and log-analyzed. But that's infrastructure management, not code quality. Separate concern.
