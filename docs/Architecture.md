# Architecture

Technical architecture for Pocket, organized in four layers.

## Layer Overview

```
┌─────────────────────────────────────┐
│  Layer 1: Mobile Client (PWA)       │  Task creation, progress timeline, diff review
├─────────────────────────────────────┤
│  Layer 2: API Gateway               │  Auth, GitHub OAuth, task endpoints, SSE streams
├─────────────────────────────────────┤
│  Layer 3: Job Orchestrator          │  Queue, checkpoints, retries, state machine
├─────────────────────────────────────┤
│  Layer 4: Intercomputer             │  Sandbox communication, tool protocol
└─────────────────────────────────────┘
```

## Layer 1: Mobile Client

Responsibilities:
- Task composer (repo selection, branch target, natural-language description)
- Live progress feed via SSE
- Mobile diff review with file summary cards
- Merge actions
- Follow-up prompt handling

Implementation: Progressive Web App (PWA) for cross-platform mobile access.

## Layer 2: API Gateway

Responsibilities:
- GitHub OAuth authentication
- Repository permission validation
- Task CRUD operations
- Server-Sent Events for progress streaming
- Push notification triggers

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tasks` | Create new task |
| GET | `/tasks/:id` | Get task status and details |
| POST | `/tasks/:id/followup` | Add follow-up instruction |
| POST | `/tasks/:id/merge` | Merge the resulting PR |

## Layer 3: Job Orchestrator

Responsibilities:
- Job queue management
- Persistent checkpoints for resumable execution
- Replay failed jobs from last successful checkpoint
- Safe step retry logic
- Branch locking to prevent conflicts
- Concurrency limits per repo
- Task state machine

### State Machine

```
QUEUED → PLANNING → EXECUTING → TESTING → PR_CREATED → AWAITING_REVIEW → MERGED
                   ↓                    ↓
               RETRYING            FAILED
                   ↓
                FAILED
```

| State | Description |
|-------|-------------|
| QUEUED | Task received, waiting for worker |
| PLANNING | Agent analyzing task and repo |
| EXECUTING | Making code changes |
| TESTING | Running tests/build verification |
| RETRYING | Attempting recovery from failure |
| PR_CREATED | Branch pushed, PR opened |
| AWAITING_REVIEW | Waiting for user review or merge |
| MERGED | PR merged, task complete |
| FAILED | Unrecoverable failure |

### Task Checkpoint Data

Every task persists:
- `task_id`, `repo`, `branch`
- `job_state`
- `execution_steps` (completed steps)
- `current_patch`
- `logs`
- `pr_url`
- `retry_count`

This enables recovery from worker restarts or network interruptions.

## Layer 4: Intercomputer

Responsibilities:
- Agent communicates with user's sandbox server
- Tool protocol for file and command operations
- Provider-agnostic (works with any sandbox setup)

### Tool Protocol

```python
read_file(path)        # Read file contents
write_file(path, content)  # Write file
run(command)           # Execute shell command
git_checkout(branch)   # Switch branch
git_commit(message)    # Commit changes
git_push()             # Push to remote
open_pr(title, body)   # Create GitHub PR
```

## Data Flow

1. User creates task via mobile client
2. API gateway validates auth and stores task
3. Job orchestrator picks up task, creates checkpoint
4. Intercomputer tool protocol executes agent on sandbox
5. Agent edits files, runs tests, pushes branch
6. Agent opens PR via GitHub API
7. Progress streamed back to mobile client via SSE
8. User reviews PR on mobile, merges from phone

## Future Considerations

- Layer 5 (LLM routing intelligence) deferred to v2
- Slack integration for task delegation
- Voice task creation
- Multi-agent collaboration
