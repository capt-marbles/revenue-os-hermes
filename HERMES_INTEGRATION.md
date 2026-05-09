# Hermes Kanban Integration — Revenue OS

## Overview

Revenue OS now has an optional bridge layer that connects its task and agent execution system to Hermes Kanban — Hermes's multi-profile collaboration board with dependency tracking, fan-out dispatch, and worker lifecycle management.

This is a **copy** at `~/users/awalker/revenue-os-hermes` — the original remains at `~/users/awalker/revenue-os`.

## Architecture

```
Revenue OS (Next.js)                    Hermes Kanban (separate process)
┌─────────────────────────────────┐     ┌─────────────────────────────────────────┐
│ scheduler-worker.ts             │     │ kanban.db (SQLite)                     │
│  ├─ HERMES_KANBAN_ENABLED=true  │     │  tasks, task_links, task_events,        │
│  │  └─ dispatchRevenueOsAgent   │     │  task_runs                              │
│  │     → creates Hermes task    │     └─────────────────────────────────────────┘
│  │                                 │           ▲
│  ├─ HERMES_KANBAN_ENABLED=false │           │ hermes kanban CLI
│  │  └─ executeAgent (legacy)     │           │
│  └─ job-queue.ts (async runner)  │     ┌─────┴──────────────────────────┐
│                                 │     │ hermes profiles:              │
│ /api/tasks/[id] (PATCH)         │     │ scout, drafter, steward,       │
│  └─ status sync → Hermes        │     │ marketing, sales-engineering  │
│                                 │     │ chief-of-staff, leo, outreach│
│ /api/hermes-stats (new)         │     └──────────────────────────────┘
│  └─ kanbanStats() → dashboard    │
└─────────────────────────────────┘
```

## Key Files

| File | Purpose |
|---|---|
| `lib/hermes/hermes-kanban-service.ts` | Low-level CLI wrapper: `kanbanCreate`, `kanbanList`, `kanbanComplete`, etc. |
| `lib/hermes/hermes-task-provider.ts` | `HermesTaskBridge` — high-level API for bridging Revenue OS ↔ Hermes |
| `lib/hermes/hermes-agent-executor.ts` | Spawn Revenue OS agents as Hermes workers; create + link fan-out tasks |
| `lib/hermes/hermes-board-stats.ts` | Dashboard stats (kanban counts, assignee load) |
| `app/api/hermes-stats/route.ts` | `GET /api/hermes-stats` endpoint |
| `lib/scheduler/scheduler-worker.ts` | Schedule fires → Hermes task (when `HERMES_KANBAN_ENABLED=true`) |
| `app/api/tasks/[id]/route.ts` | PATCH status → sync to linked Hermes task |

## Enabling Hermes Kanban

```bash
# In revenue-os-hermes/.env.local
HERMES_KANBAN_ENABLED=true
REVENUE_OS_AGENT_RUN_URL=http://localhost:3000/api/runs
```

When `HERMES_KANBAN_ENABLED=true`, scheduled agents create Hermes tasks instead of calling `executeAgent` directly. The Hermes dispatcher (running inside the Hermes gateway) picks up the task, spawns the assigned profile, and the worker executes.

## Agent → Hermes Profile Mapping

| Revenue OS Agent Slug | Hermes Profile |
|---|---|
| `scout` | `scout` |
| `drafter` | `drafter` |
| `steward` | `steward` |
| `marketing` | `marketing` |
| `sales-engineering` | `sales-engineering` |
| `chief-of-staff` | `chief-of-staff` |
| `leo` | `leo` |
| `outreach` | `outreach` |

## Task Flow Examples

### 1. Scheduled Agent → Hermes (HERMES_KANBAN_ENABLED=true)

```
Schedule fires (cron tick)
  └─ scheduler-worker.ts::fireAgentSchedule()
       └─ dispatchRevenueOsAgentToHermes()
            ├─ kanbanCreate(title="Scout: sweep Unity studios", assignee="scout")
            ├─ db.insert(agentRuns) { trigger: "kanban-dispatched" }
            └─ Hermes dispatcher picks up task → spawns scout worker
                 └─ worker reads Revenue OS agent prompt from task body
                      └─ executes as Revenue OS agent
```

### 2. Status Sync (Revenue OS → Hermes)

```
User moves a task to "done" in the UI
  └─ PATCH /api/tasks/[id] { status: "done" }
       └─ extractHermesTaskId(description) → "t_abc123"
            └─ hermesBridge.completeHermesTask("t_abc123")
                 └─ hermes kanban complete t_abc123 --summary "..."
```

### 3. Fan-out (Parallel Research)

```
ChiefOfStaff decomposes: "Research 3 Unity hosting alternatives"
  └─ hermesBridge.fanOut("Synthesize alternatives", [
       { title: "Research: AWS GameLift", body: "...", assignee: "researcher" },
       { title: "Research: Dedibox",     body: "...", assignee: "researcher" },
       { title: "Research: Papaya",      body: "...", assignee: "researcher" },
    ])
  └─ Creates 3 parallel Hermes tasks + returns their IDs
       └─ Caller creates synthesis task with parentIds = [3 child IDs]
```

## Hermes CLI Quick Reference

```bash
# Board
hermes kanban init                              # Initialize kanban.db
hermes kanban boards list                       # Show boards
hermes kanban stats                            # Per-status counts

# Tasks
hermes kanban create "Do the thing" --assignee scout --priority 80 --json
hermes kanban list --assignee scout --status ready --json
hermes kanban show t_abc123 --json
hermes kanban complete t_abc123 --summary "Done" --metadata '{"key":"value"}'
hermes kanban block t_abc123 "Need input"
hermes kanban link t_parent t_child             # child waits for parent

# Worker lifecycle
hermes kanban claim t_abc123                  # Atomically claim (sets working)
hermes kanban heartbeat t_abc123 --note "epoch 3/10"
hermes kanban runs t_abc123                    # Show attempt history
hermes kanban reclaim t_abc123                 # Abort + reset to ready
hermes kanban reassign t_abc123 drafter         # Move to different profile

# Dispatch
hermes kanban dispatch                         # One dispatcher pass
hermes gateway start                           # Start background dispatcher (runs every 60s)
hermes kanban tail t_abc123                    # Follow task events in real-time
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HERMES_KANBAN_ENABLED` | `false` | When `true`, scheduler creates Hermes tasks instead of calling `executeAgent` |
| `REVENUE_OS_AGENT_RUN_URL` | `http://localhost:3000/api/runs` | URL for Hermes workers to post results back |
| `HERMES_KANBAN_BOARD` | (default board) | Which Hermes kanban board to use |
| `HERMES_TENANT` | — | Tenant namespace passed as `--tenant` on task create |

## Running the Gateway (Dispatcher)

The Hermes gateway runs a background dispatcher that ticks every 60 seconds:

```bash
hermes gateway start   # Start the gateway (background service)
hermes gateway status  # Check if it's running
hermes kanban watch    # Live-stream all task events
```

Without the gateway running, tasks stay in `ready` — they won't auto-promote or spawn workers.

## Dashboard Integration

`GET /api/hermes-stats` returns:

```json
{
  "kanban": {
    "totalTasks": 24,
    "byStatus": { "triage": 2, "todo": 5, "ready": 3, "working": 2, "done": 10, "blocked": 1, "archived": 1 },
    "oldestReadyAgeMs": 180000
  },
  "assignees": [
    { "profile": "scout", "taskCount": 4, "activeWorkers": 1 },
    { "profile": "drafter", "taskCount": 3, "activeWorkers": 0 }
  ],
  "dispatcher": { "lastRun": "2026-05-08T15:30:00Z", "reclaimedCount": 0, "promotedCount": 2, "spawnedCount": 1 }
}
```

## Trade-offs vs. Legacy System

| Aspect | Legacy (executeAgent) | Hermes Kanban |
|---|---|---|
| **Dependency tracking** | None | `parents=[...]` auto-gates child promotion |
| **Fan-out parallelism** | Manual / sequential | `fanOut()` creates N parallel tasks |
| **Worker recovery** | Retry from schedule | Reclaim + retry with different model |
| **Audit trail** | agentRuns table | Full event log (created, claimed, heartbeat, blocked, completed) |
| **Complexity** | Simple | More moving parts |
| **Status visibility** | Poll agentRuns | `hermes kanban board` / `tail <id>` |

## TODO

- [x] Add `hermes_task_id` column to tasks table
- [x] Wire `/api/hermes-stats` into the Command Center dashboard
- [x] Implement sequence type in scheduler-worker (sequence → kanban fan-out)
- [x] Add notification callbacks (Telegram/Discord when tasks complete)
- [x] Implement `dispatchRevenueOsAgentToHermes` with proper SSE tracking
