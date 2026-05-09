# Revenue OS — Hermes Edition

Head of Growth command center for running outbound pipeline motion with a Chief of Staff front door, durable company memory, and first-class ingestion from lead and signal sources.

This is a fork of the original Revenue OS that delegates task and agent execution to **Hermes Kanban**. Scheduled agents are dispatched as Hermes tasks (with dependency tracking, fan-out, worker reclaim, and full event audit), and the operator UI stays as the human-facing surface. See `HERMES_INTEGRATION.md` for the architecture and `HERMES_KANBAN_ENABLED` env flag.

The app is now centered on one operator loop:
- wake up to a ranked opportunity queue
- review the daily briefing
- choose cold or warm-intro paths
- generate draft outreach
- sync the right records into Attio
- keep follow-up and learning state moving

## What Shipped

- `Command Center` is the homepage
- `Opportunity` is the canonical operating object
- `Daily Briefing` is persisted in `briefing_snapshots`
- `Apollo` and `signals` imports feed the same opportunity pipeline
- queue actions support:
  - path selection
  - model-backed draft generation with deterministic fallback
  - real Attio sync on the opportunity write path
- queue mutations now rehydrate from the aggregated command-center payload and refresh the whole page

## Product Shape

- `Front door`: Head of Growth Command Center
- `Brain`: Chief of Staff
- `Memory`: ICP, offering, competitors, brand voice, and operating context
- `Feeders`: Apollo-style prospect imports, monitored signal imports, webhooks, CRM events
- `Outputs`: ranked opportunities, drafts, sync events, follow-up state, learning signals

## Tech Stack

- **Next.js 16** (App Router, Turbopack in dev)
- **React 19**
- **Tailwind CSS v4**
- **Drizzle ORM** + **better-sqlite3**
- **SQLite** in `data/revenue-os.db`
- **Claude CLI** for agent and draft-generation flows

## Quick Start

```bash
cd revenue-os-hermes
npm install
npm run setup
npm run dev
```

Open `http://localhost:3000` unless you started dev on a different port.

## Database Setup

`npm run setup`:
1. copies `.env.example` to `.env.local` if needed
2. creates `data/`
3. runs the local seed/setup path

The local setup path now also self-heals older SQLite baselines by ensuring the newer operational and command-center tables exist before seeding. That matters if your local DB was created from the original migration set and the repo schema has since moved ahead.

Useful commands:

| Command | Description |
|---------|-------------|
| `npm run setup` | First-time local setup |
| `npm run db:seed` | Re-run seed/setup scripts |
| `npm run db:reset` | Delete the local DB and rebuild from seed |
| `npm run dev` | Start the app |
| `npm run test` | Run tests |

## Main Flows

### 1. Opportunity ingestion

Current ingestion surfaces:
- `POST /api/opportunities/ingest`
- `POST /api/sources/apollo/import`
- `POST /api/sources/signals/import`
- `POST /api/events/webhook`

All of them normalize into a shared `OpportunityCandidate` shape, then run through:
- normalization
- deterministic dedupe
- scoring
- persistence into `opportunities`
- optional `intro_paths` enrichment

### 2. Command Center read path

`GET /api/command-center` returns the aggregated operator payload:
- persisted daily briefing
- ranked opportunity queue
- source health
- controls
- learning state

### 3. Opportunity actions

Current write-side actions:
- `POST /api/opportunities/:id/path-select`
- `POST /api/opportunities/:id/draft`
- `POST /api/opportunities/:id/sync`

The queue UI uses these APIs directly, then rehydrates from the aggregated command-center payload so the page stays on server truth.

### 4. Attio sync

Attio sync is implemented on the sync path for contact create/update flows:
- builds a person payload from the current opportunity
- asserts or updates the Attio person record
- records the result in `opportunity_sync_events`
- updates `attioRecordRef` on the opportunity when successful

Required env var:
- `ATTIO_API_KEY`

## Environment Variables

See `.env.example`. The main ones currently used in local development are:

```bash
OPERATOR_TOKEN=dev-token-change-me
DEFAULT_TENANT_ID=01JDEFAULT0000000000000000
# ATTIO_API_KEY=...
# MATON_API_KEY=...
# AGENCY_AGENTS_PATH=/path/to/agency-agents
```

## Project Structure

```text
app/
  command-center/   primary operator surface
  copilot/          Chief of Staff chat surface
  inbox/            triage surface
  tasks/            kanban and approvals
  goals/            strategic goals
  api/              route handlers

components/
  command-center/   queue and command-center UI
  copilot/          CoS chat UI
  tasks/            task UI
  layout/           app shell and nav

lib/
  command-center/   aggregated read model + briefing generation
  opportunities/    candidate, ingest, dedupe, scoring, drafting, sync
  crm/              Attio client
  agents/           Chief of Staff and specialist execution
  orchestration/    triggers, policies, automation routing

db/
  schema.ts         current schema
  migrations/       SQL migrations
  seed.ts           local setup + compatibility repair
  seed-goals.ts     goals and operating context seed
```

## Verification Notes

The repo currently has known unrelated TypeScript failures outside the command-center slice. Targeted lint and route-level tests pass for the new opportunity and command-center flows, but a clean `tsc --noEmit` is not yet green across the whole repo.
