# User Stories

Core workflows for Pocket users.

## Story A: Founder — Benchmark Regression Fix

**Context:** Alex is a technical founder working at a coffee shop between meetings. A monitoring alert shows a benchmark regression in the provider router.

**Trigger:** "Benchmark timeout issue in provider router"

**Steps:**

1. Opens Pocket mobile app
2. Selects repository: `acme/backend`
3. Selects target branch: `main`
4. Chooses risk level: medium
5. Enters task description: "Fix benchmark timeout issue in provider router and add regression tests"
6. Submits task

**Background execution:**

- Pocket clones repo to sandbox
- Agent identifies timeout in `provider_factory.py` async path
- Agent adds caching layer with TTL
- Agent writes regression tests
- Tests pass, branch pushed
- PR opened with summary

**Result (20 minutes later):**

Alex receives push notification. Opens Pocket:
- "PR #44 ready: Fix benchmark timeout in provider router"
- File summary card shows: caching layer added, tests added
- Reviews on phone, taps "Merge"
- PR merged from phone

**Key value:** High-leverage coding work done during dead time between meetings.

---

## Story B: On-Call Engineer — Production Investigation

**Context:** Jordan is on-call. A GitHub issue reports a memory leak in the websocket worker.

**Trigger:** "Memory leak in websocket worker"

**Steps:**

1. Opens Pocket
2. Selects repository: `acme/realtime-service`
3. Selects branch: `main`
4. Chooses risk level: high (production impact)
5. Enters: "Investigate memory leak in websocket worker, patch safely, add monitoring logs"
6. Submits task

**Background execution:**

- Pocket clones repo
- Agent analyzes heap dumps and worker code
- Identifies unbounded event listener accumulation
- Agent implements cleanup on disconnect
- Agent adds memory metrics logging
- Agent creates test reproducing the leak
- Tests pass, PR created

**Result:**

Jordan receives notification. Opens Pocket:
- Root cause summary: "Event listeners not cleaned up on disconnect"
- Changed files: 3 files modified
- Test evidence: leak reproduction test passes
- PR link: "#127"

**Key value:** Production incident handled without laptop. Detailed analysis returned while away.

---

## Story C: CTO — Architecture Refactor Delegation

**Context:** Taylor is a CTO. Architecture debt needs cleanup but doesn't require their direct attention.

**Trigger:** "Provider adapter refactor"

**Steps:**

1. Opens Pocket
2. Selects repository: `platform/core`
3. Selects branch: `dev`
4. Chooses risk level: low (new branch, no production impact)
5. Enters: "Refactor all provider adapters to use unified tool schema factory"
6. Submits task

**Background execution:**

- Pocket clones repo
- Agent inventories existing adapter patterns
- Agent designs unified schema factory
- Agent migrates adapters one by one, running tests after each
- Agent updates documentation
- PR created when all adapters migrated

**Result (hours later):**

Taylor receives notification during a meeting. After meeting:
- Opens Pocket
- Reviews file summary cards for each migrated adapter
- Approves PR, merges from phone
- Returns to meetings

**Key value:** Hours of tedious refactoring delegated. CTO focuses on high-leverage work.

---

## Common Pattern

All stories follow the same arc:

```
Away from laptop → Describe task → Lock phone → Return → Review PR → Merge
```

Pocket enables engineering execution from anywhere, with full async durability.
