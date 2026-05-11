# Plan: Pocket Self-Improvement via User Feedback (v1.5)

**Created:** 2026-05-11 | **Finalized:** 2026-05-11
**Goal:** Pocket gets smarter after every conversation by learning from user ratings — improving prompts, tool behavior, and configuration for future sessions.

---

## The loop

```
User imports any GitHub repo → conversation with Pocket → rates session (1-5 ★ + categories + comment)
                                                                      │
                                                            Post-session analysis
                                                            (separate LLM call)
                                                                      │
                                                   ┌──────────────────┼──────────────────┐
                                                   ▼                  ▼                  ▼
                                            User preferences    Technical patterns   Session quality
                                            (per-user)          (shared)             (shared)
                                                   │                  │                  │
                                                   └──────────────────┴──────────────────┘
                                                                      │
                                                       Saved to skills/ + memory/
                                                                      │
                                                       Injected into future system prompts
```

---

## Design decisions (all locked)

| Decision | Choice |
|---|---|
| **Rating** | 1-5 stars + structured categories + optional free-text comment |
| **Structured categories** | Task Completion, Code Quality, Communication Clarity, Speed |
| **Learning scope** | Per-user preferences + shared technical patterns |
| **Automation** | Fully automated — post-session LLM extracts and applies lessons |
| **What changes** | System prompts (context), tool behavior (permissions), configuration (defaults) |
| **Skill storage** | Markdown files in `~/.pocket/skills/` |
| **Memory storage** | JSON files in `~/.pocket/memory/` |
| **Update timing** | After every rated session, analysis runs asynchronously |
| **Context compression** | Excluded — sessions stop at token limit |

---

## Storage layout

```
~/.pocket/
├── skills/                          ← Markdown files (procedural)
│   ├── shared/                      ← Cross-user technical patterns
│   │   ├── nodejs-debugging.md
│   │   ├── monorepo-workflows.md
│   │   └── session-quality.md       ← What makes sessions succeed/fail
│   └── users/
│       └── {userId}/                ← Per-user skills
│           ├── communication-style.md
│           └── workflow-habits.md
├── memory/
│   ├── shared.json                  ← Cross-user facts
│   └── users/
│       └── {userId}.json            ← Per-user preferences
├── config.json                      ← Existing
└── sessions/                        ← Existing
```

In v1 (single user): `{userId}` is "default". Shared and per-user both load into the system prompt.

---

## Rating UX (mobile-first)

Session ends → rating card appears at the bottom of the chat:

```
┌─────────────────────────────────┐
│  Rate this session              │
│                                 │
│  ★ ★ ★ ★ ☆   (4/5)             │
│                                 │
│  What was good?                 │
│  ☑ Task completed successfully │
│  ☑ Code quality was solid      │
│  ☐ Communication was clear     │
│  ☐ Speed was good              │
│                                 │
│  Anything else?                 │
│  ┌─────────────────────────┐   │
│  │ Fixed the bug on first   │   │
│  │ try, tests were thorough │   │
│  └─────────────────────────┘   │
│                                 │
│  [ Skip ]          [ Submit ]   │
└─────────────────────────────────┘
```

Rating is optional — users can skip.

---

## Post-session analysis pipeline

### Trigger

Session transitions to `done` AND has a rating → pipeline runs asynchronously.

### Analysis prompt

Built from:
- Full conversation transcript (from `events.jsonl`)
- Rating (star count + categories + comment)
- Existing skills and memory (to avoid duplicates)

Sent to a separate LLM call (cheaper model, non-streaming):

```
Analyze this Pocket coding agent session.

RATING: 4/5 stars
Categories rated good: Task Completion, Code Quality
User comment: "Fixed the bug on first try, tests were thorough"

SESSION TRANSCRIPT:
[full conversation from events.jsonl]

EXISTING KNOWLEDGE:
[existing skills + memory entries]

Extract lessons as JSON:
{
  "user_preferences": [
    {"content": "User appreciates when Pocket runs tests after each change"}
  ],
  "technical_patterns": [
    {"name": "nodejs-timeout-debugging", "content": "..."},
  ],
  "session_quality": [
    {"content": "Good sessions: agent read files before editing, ran tests after changes"}
  ],
  "config_suggestions": [
    {"key": "permissions.defaults.bash", "value": "more_permissive", "reason": "..."}
  ]
}
```

### Application

Response parsed → writes to:
- `~/.pocket/memory/users/{userId}.json` — user_preferences
- `~/.pocket/skills/shared/` — technical_patterns (new markdown files)
- `~/.pocket/skills/shared/session-quality.md` — session_quality (appended)
- `config_suggestions` logged to console, not auto-applied

---

## System prompt injection

Every new session gets:

```
You are Pocket, an autonomous coding agent.

=== ABOUT THIS USER ===
- Appreciates when Pocket runs tests after each change
- Primary language: TypeScript
- Prefers concise explanations

=== TECHNICAL PATTERNS ===
## Node.js Timeout Debugging
When debugging test timeouts, check for async operations without await...

=== SESSION QUALITY GUIDELINES ===
Good sessions: read files before editing, ran tests after changes, kept commits small
Bad sessions: looped on same error, edited without reading, repeated permission requests

Repository: {task}
Branch: {branch}
...
```

---

## Files changed

| File | Change |
|---|---|
| `packages/core/src/index.ts` | Add `SessionRating`, `RatingCategory` types |
| `packages/agent/src/skill-store.ts` | NEW — read/write markdown skills |
| `packages/agent/src/memory-store.ts` | NEW — read/write JSON memory (per-user + shared) |
| `packages/agent/src/learning-pipeline.ts` | NEW — post-session analysis + LLM extraction |
| `packages/agent/src/system-prompt.ts` | NEW — unified builder (user + skills + memory + bootstrap) |
| `apps/server/src/index.ts` | Add `POST /api/sessions/:id/rate`, trigger pipeline on done, use prompt builder |
| `apps/web/src/features/session/components/RatingCard.tsx` | NEW — rating UI |

---

## Verification

1. Create session, complete task, rate 4★ + Task Completion + "tests were thorough"
2. Check `~/.pocket/memory/users/default.json` — should have new preference entry
3. Check `~/.pocket/skills/shared/` — should have new technical pattern files
4. Create new session on different repo
5. Verify system prompt includes "ABOUT THIS USER" and learned content
6. Verify Pocket behavior reflects preferences
