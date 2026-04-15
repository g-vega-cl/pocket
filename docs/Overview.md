# Pocket

**Mobile-first self-hosted autonomous coding agent for private repositories.**

Pocket enables developers, founders, and engineering leaders to ship code, review diffs, and merge fixes entirely from a phone. Describe a task, lock your phone, and return to a ready PR.

## Code Philosophy

> **Code is truth.** Documentation provides context.

When code and docs conflict, trust the code. Docs exist to explain:
- Why code was built a certain way
- Where related documentation lives
- The purpose and intent behind implementation choices

Docs may be slightly stale; code is always ground truth.

## Documentation Directory

| Document | Purpose |
|----------|---------|
| [Architecture](Architecture.md) | Technical architecture, layers, data flow, task state machine |
| [User Stories](UserStories.md) | Core use cases: founder workflow, on-call workflow, CTO delegation |

## Core Concepts

**Task-based over edit-based.** Unlike IDE-centric tools (Cursor, Copilot), Pocket works in async background jobs. You describe what you want, not how to edit files.

**Mobile-first review.** Diffs are surfaced as file summary cards, not raw terminal output. Progress is a timeline, not a terminal log.

**Self-hosted.** No external sandbox vendors. Code executes on your own infrastructure.

**PR-native.** Every task result is a GitHub PR, with full audit trail and code review workflow.

## Key Workflow

```
describe task → lock phone → background execution → PR ready → review/merge from phone
```

## Repository Structure

```
pocket/
├── docs/
│   ├── Overview.md      # This file
│   ├── Architecture.md  # Technical architecture
│   └── UserStories.md   # User narratives
└── README.md            # Quick-start guide
```
