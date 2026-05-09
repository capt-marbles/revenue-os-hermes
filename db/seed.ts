import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { ulid } from "ulid";

const dbPath = path.join(process.cwd(), "data", "revenue-os.db");

// Ensure data directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite, { schema });

// Run migrations
const migrationsPath = path.join(process.cwd(), "db", "migrations");
if (fs.existsSync(migrationsPath)) {
  migrate(db, { migrationsFolder: migrationsPath });
  console.log("Migrations applied.");
}

function ensureSharedMemorySchema() {
  const columns = sqlite
    .prepare("PRAGMA table_info(shared_memory)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("layer")) {
    sqlite.exec("ALTER TABLE shared_memory ADD COLUMN layer TEXT NOT NULL DEFAULT 'global';");
  }

  if (!columnNames.has("scope_ref_id")) {
    sqlite.exec("ALTER TABLE shared_memory ADD COLUMN scope_ref_id TEXT NOT NULL DEFAULT '';");
  }

  if (!columnNames.has("confidence")) {
    sqlite.exec("ALTER TABLE shared_memory ADD COLUMN confidence REAL DEFAULT 1;");
  }

  sqlite.exec("DROP INDEX IF EXISTS memory_tenant_category_key;");
  sqlite.exec("DROP INDEX IF EXISTS memory_tenant_layer_scope_category_key;");
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS memory_tenant_layer_scope_category_key
    ON shared_memory (tenant_id, layer, scope_ref_id, category, key);
  `);
}

function ensureAgentsSchema() {
  const columns = sqlite
    .prepare("PRAGMA table_info(agents)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("agent_type")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'specialist';");
  }
}

function ensureOperationalTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      target_agent_id TEXT,
      conditions TEXT NOT NULL DEFAULT '{}',
      actions TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      filter_config TEXT NOT NULL DEFAULT '{}',
      schedule_config TEXT NOT NULL DEFAULT '{}',
      dedupe_key_strategy TEXT DEFAULT '',
      last_fired_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action
    );
  `);
}

function ensureTasksSchema() {
  const columns = sqlite
    .prepare("PRAGMA table_info(tasks)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("desk_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN desk_id TEXT REFERENCES desks(id);");
  }

  if (!columnNames.has("parent_task_id")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;");
  }

  if (!columnNames.has("source")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';");
  }

  if (!columnNames.has("approval_mode")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'none';");
  }

  if (!columnNames.has("approval_status")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';");
  }

  if (!columnNames.has("depth")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN depth INTEGER DEFAULT 0;");
  }

  if (!columnNames.has("timeout_seconds")) {
    sqlite.exec("ALTER TABLE tasks ADD COLUMN timeout_seconds INTEGER;");
  }
}

function ensureCopilotConversationSchema() {
  const columns = sqlite
    .prepare("PRAGMA table_info(copilot_conversations)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("desk_id")) {
    sqlite.exec("ALTER TABLE copilot_conversations ADD COLUMN desk_id TEXT REFERENCES desks(id);");
  }

  if (!columnNames.has("owner_agent_id")) {
    sqlite.exec("ALTER TABLE copilot_conversations ADD COLUMN owner_agent_id TEXT REFERENCES agents(id);");
  }
}

function ensureConversationMessages(
  conversationId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const existingMessageCount = db
    .select({ id: schema.copilotMessages.id })
    .from(schema.copilotMessages)
    .where(eq(schema.copilotMessages.conversationId, conversationId))
    .all().length;

  if (existingMessageCount > 0) {
    return;
  }

  db.insert(schema.copilotMessages).values(
    messages.map((message) => ({
      id: ulid(),
      conversationId,
      role: message.role,
      content: message.content,
    })),
  ).run();
}

function pruneDuplicateEmptyConversations() {
  const rows = sqlite.prepare(`
    SELECT
      c.id AS id,
      COALESCE(c.desk_id, '__global__') AS scope_key
    FROM copilot_conversations c
    LEFT JOIN copilot_messages m ON m.conversation_id = c.id
    WHERE c.tenant_id = ?
      AND c.title IS NULL
    GROUP BY c.id, c.desk_id
    HAVING COUNT(m.id) = 0
    ORDER BY c.updated_at DESC, c.created_at DESC
  `).all(TENANT_ID) as Array<{ id: string; scope_key: string }>;

  const seenScopes = new Set<string>();
  const duplicateIds: string[] = [];

  for (const row of rows) {
    if (seenScopes.has(row.scope_key)) {
      duplicateIds.push(row.id);
      continue;
    }
    seenScopes.add(row.scope_key);
  }

  if (duplicateIds.length === 0) {
    return;
  }

  const deleteConversation = sqlite.prepare("DELETE FROM copilot_conversations WHERE id = ?");
  const transaction = sqlite.transaction((ids: string[]) => {
    for (const id of ids) {
      deleteConversation.run(id);
    }
  });

  transaction(duplicateIds);
  console.log(`Pruned ${duplicateIds.length} duplicate empty Co-Pilot conversations.`);
}

function ensureCommandCenterTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      goal_id TEXT,
      title TEXT NOT NULL,
      account_name TEXT,
      primary_contact_name TEXT,
      primary_contact_email TEXT,
      primary_contact_linkedin TEXT,
      opportunity_type TEXT NOT NULL DEFAULT 'outbound',
      status TEXT NOT NULL DEFAULT 'discovered',
      primary_path TEXT NOT NULL DEFAULT 'none',
      score REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      rationale_summary TEXT,
      source_summary TEXT,
      freshest_signal_at TEXT,
      last_activity_at TEXT,
      attio_record_ref TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS opportunities_tenant_title_account_contact
    ON opportunities (tenant_id, title, account_name, primary_contact_email);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_sources (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      payload_fingerprint TEXT,
      freshness_score REAL NOT NULL DEFAULT 0,
      raw_summary TEXT,
      source_evidence TEXT NOT NULL DEFAULT '{}',
      ingested_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS opportunity_sources_unique_ref
    ON opportunity_sources (tenant_id, source_type, source_ref);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS intro_paths (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      connector_type TEXT NOT NULL,
      mutual_ref TEXT,
      mutual_name TEXT,
      path_summary TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      freshness REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'available',
      evidence TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      draft_type TEXT NOT NULL,
      subject TEXT,
      content TEXT NOT NULL,
      model_ref TEXT,
      status TEXT NOT NULL DEFAULT 'generated',
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_sync_events (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      target_system TEXT NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      external_ref TEXT,
      payload_summary TEXT,
      error_class TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_outcomes (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      outcome_type TEXT NOT NULL,
      attributed_source TEXT,
      attributed_template TEXT,
      attribution_confidence REAL NOT NULL DEFAULT 0,
      notes TEXT,
      recorded_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS briefing_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      summary_markdown TEXT NOT NULL,
      structured_payload TEXT NOT NULL DEFAULT '{}',
      queue_count INTEGER NOT NULL DEFAULT 0,
      top_opportunity_id TEXT,
      freshness_label TEXT NOT NULL DEFAULT 'fresh',
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (top_opportunity_id) REFERENCES opportunities(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS briefing_snapshots_tenant_date
    ON briefing_snapshots (tenant_id, snapshot_date);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS copilot_action_decisions (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      status TEXT NOT NULL,
      result_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (conversation_id) REFERENCES copilot_conversations(id) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (message_id) REFERENCES copilot_messages(id) ON UPDATE no action ON DELETE no action
    );
  `);

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS copilot_action_decisions_unique
    ON copilot_action_decisions (tenant_id, message_id, action_key);
  `);
}

ensureSharedMemorySchema();
ensureAgentsSchema();
ensureOperationalTables();
ensureTasksSchema();
ensureCopilotConversationSchema();
ensureCommandCenterTables();

// Seed default tenant
const TENANT_ID = process.env.DEFAULT_TENANT_ID || "01JDEFAULT0000000000000000";
const CHIEF_OF_STAFF_AGENT_ID = "01CHIEFOFSTAFF000000000000";
const FEEDBACK_AGENT_ID = "01FEEDBACK0000000000000000";
const DAILY_STANDUP_TRIGGER_ID = "01TRIGGERDAILYSTANDUP000000";
const EXEC_SUMMARY_POLICY_ID = "01POLICYEXECSUMMARY00000000";
const OUTREACH_WAKE_POLICY_ID = "01POLICYOUTREACHWAKE000000";
const OUTREACH_WAKE_TRIGGER_ID = "01TRIGGEROUTREACHWAKE000000";
const TELEGRAM_TRIAGE_POLICY_ID = "01POLICYTELEGRAMTRIAGE0000";
const TELEGRAM_IMPORTANT_TRIGGER_ID = "01TRIGGERTELEGRAMIMPORTANT";
const WEBHOOK_CRM_POLICY_ID = "01POLICYWEBHOOKCRM00000000";
const WEBHOOK_CRM_TRIGGER_ID = "01TRIGGERWEBHOOKCRM000000";
const DEMO_OUTBOUND_TASK_ID = "01TASKDEMOOUTBOUND000000000";
const DEMO_SIGNAL_TASK_ID = "01TASKDEMOSIGNAL00000000000";
const DEMO_TELEGRAM_CONVERSATION_ID = "01CONVDEMOTELEGRAM0000000";
const DEMO_WEBHOOK_CONVERSATION_ID = "01CONVDEMOWEBHOOK00000000";
const DEMO_TEMPLATE_ID = "01TPLDEMOOUTBOUND000000000";
const DEMO_OPPORTUNITY_1_ID = "01OPPDEMOSTEAMMIGRATION000";
const DEMO_OPPORTUNITY_2_ID = "01OPPDEMOHATHORAWARM00000";
const DEMO_OPPORTUNITY_3_ID = "01OPPDEMOFOLLOWUP00000000";

const existingTenant = db.select().from(schema.tenants).where(
  eq(schema.tenants.id, TENANT_ID)
).get();

if (!existingTenant) {
  db.insert(schema.tenants).values({
    id: TENANT_ID,
    name: "Gameye",
    slug: "gameye",
    settings: JSON.stringify({
      timezone: "UTC",
      defaultModel: "sonnet",
    }),
  }).run();
  console.log("Seeded default tenant: Gameye");
} else {
  console.log("Tenant already exists, skipping seed.");
}

// Seed initial shared memory entries
const memoryEntries = [
  {
    id: ulid(),
    tenantId: TENANT_ID,
    layer: "global" as const,
    scopeRefId: "",
    category: "icp",
    key: "primary",
    value: `# Ideal Customer Profile — Gameye

## Company Profile
- **Industry:** Game development studios (indie to AAA)
- **Size:** 5-500 employees
- **Stage:** Have a multiplayer game in development or live
- **Tech:** Need dedicated game server hosting/orchestration

## Decision Maker
- **Title:** CTO, Lead Backend Engineer, DevOps Lead
- **Pain points:** Scaling multiplayer infrastructure, managing server costs, reducing latency
- **Buying triggers:** Launching a new multiplayer title, scaling existing infrastructure, migrating from self-hosted

## Qualification Criteria
- Active multiplayer game project
- Budget for infrastructure ($500+/mo)
- Technical team capable of integration`,
    updatedBy: "human",
    confidence: 1,
  },
  {
    id: ulid(),
    tenantId: TENANT_ID,
    layer: "global" as const,
    scopeRefId: "",
    category: "brand_voice",
    key: "primary",
    value: `# Brand Voice — Gameye

## Tone
- Technical but approachable
- Confident, not salesy
- Developer-to-developer communication

## Style
- Lead with technical value, not marketing speak
- Use concrete numbers and benchmarks
- Reference real infrastructure concepts (containers, regions, latency)

## Avoid
- Buzzwords without substance
- Overpromising on performance
- Generic SaaS marketing language`,
    updatedBy: "human",
    confidence: 1,
  },
  {
    id: ulid(),
    tenantId: TENANT_ID,
    layer: "global" as const,
    scopeRefId: "",
    category: "process",
    key: "operating-model",
    value: `# Operating Model

- The Chief of Staff is the primary interface for operators.
- Specialists are created or woken by the Chief of Staff when recurring work, tool ownership, or triggers justify it.
- Shared memory stores durable organizational context, not raw chat transcripts.
- Sensitive or user-visible actions should be surfaced for approval before being sent.`,
    updatedBy: "human",
    confidence: 1,
  },
];

for (const entry of memoryEntries) {
  const existing = db.select().from(schema.sharedMemory).where(
    and(
      eq(schema.sharedMemory.tenantId, entry.tenantId),
      eq(schema.sharedMemory.layer, entry.layer),
      eq(schema.sharedMemory.scopeRefId, entry.scopeRefId),
      eq(schema.sharedMemory.category, entry.category),
      eq(schema.sharedMemory.key, entry.key),
    )
  ).get();

  if (!existing) {
    db.insert(schema.sharedMemory).values(entry).run();
    console.log(`Seeded shared memory: ${entry.category}/${entry.key}`);
  }
}

const existingChiefOfStaff = db.select().from(schema.agents).where(
  eq(schema.agents.id, CHIEF_OF_STAFF_AGENT_ID)
).get();

if (!existingChiefOfStaff) {
  db.insert(schema.agents).values({
    id: CHIEF_OF_STAFF_AGENT_ID,
    tenantId: TENANT_ID,
    name: "Chief of Staff",
    slug: "chief-of-staff",
    agentType: "chief_of_staff",
    source: "custom",
    description: "Primary operating interface. Plans work, delegates to specialists, and reports progress back to the operator.",
    capabilities: JSON.stringify(["planning", "delegation", "triage", "memory-write"]),
    systemPrompt: `You are the Chief of Staff for Gameye.

You are the primary operating interface for the team.

Your responsibilities:
1. Triage inbound requests, goals, and operational signals
2. Decide whether to answer directly, create tasks, or delegate to specialists
3. Create or wake specialists when repeated work, trigger ownership, or tool specialization justifies it
4. Keep plans, tasks, and memory aligned with the team's goals
5. Escalate risky or user-visible actions for approval before they are sent

Operating principles:
- Optimize for user outcomes, not agent activity
- Prefer one accountable plan over many disconnected actions
- Use shared memory for durable organizational knowledge
- Treat specialists as internal execution units, not the primary user interface
- Summarize work clearly with next steps, blockers, and decisions needed`,
    model: "sonnet",
    tools: JSON.stringify([]),
    status: "idle",
    config: JSON.stringify({
      isPrimaryInterface: true,
      approvalMode: "adaptive",
      canSpawnSpecialists: true,
    }),
  }).run();
  console.log("Seeded Chief of Staff agent.");
}

const existingFeedbackAgent = db.select().from(schema.agents).where(
  eq(schema.agents.id, FEEDBACK_AGENT_ID)
).get();

if (!existingFeedbackAgent) {
  db.insert(schema.agents).values({
    id: FEEDBACK_AGENT_ID,
    tenantId: TENANT_ID,
    name: "Outreach Feedback Loop",
    slug: "outreach-feedback-loop",
    agentType: "specialist",
    source: "custom",
    description: "Checks for email replies to outreach, updates response tracking, computes template effectiveness, and writes insights to shared memory.",
    capabilities: JSON.stringify(["crm-read", "email-read", "memory-write", "analytics"]),
    systemPrompt: `You are the Outreach Feedback Loop agent for Gameye. Your job is to close the feedback loop on outreach campaigns.

## What you do:
1. Check for new email replies or CRM activity related to recent outreach sends
2. For each reply found, record it as an outreach response with sentiment analysis
3. Compute template effectiveness metrics (reply rate, positive sentiment rate) by ICP segment
4. Write a concise insight summary to shared memory so other agents can use it

## How to report responses:
POST to /api/outreach/responses with:
- sendId: the outreach send ID
- responseType: "reply" | "bounce" | "open" | "meeting_booked"
- sentiment: "positive" | "neutral" | "negative"
- notes: brief summary of the response

## How to get effectiveness data:
GET /api/outreach/effectiveness to see current template performance

## How to update shared memory:
POST to /api/memory with:
- category: "outreach_insights"
- key: "template_effectiveness"
- value: your markdown summary of what's working and what's not

## Output format:
Produce a brief report:
- New responses found: N
- Template performance changes: list any templates with significant changes in reply rate
- Insights written to memory: yes/no
- Recommended actions: any templates that should be retired or promoted`,
    model: "sonnet",
    tools: JSON.stringify([]),
    status: "idle",
    config: JSON.stringify({ autoSchedule: true }),
  }).run();
  console.log("Seeded feedback loop agent.");
}

const existingPolicy = db.select().from(schema.policies).where(
  eq(schema.policies.id, EXEC_SUMMARY_POLICY_ID)
).get();

if (!existingPolicy) {
  db.insert(schema.policies).values({
    id: EXEC_SUMMARY_POLICY_ID,
    tenantId: TENANT_ID,
    name: "Chief of Staff Delegation Policy",
    type: "delegation",
    scope: "global",
    targetAgentId: CHIEF_OF_STAFF_AGENT_ID,
    conditions: JSON.stringify({
      routes: [
        "direct response for simple requests",
        "delegate recurring outreach analysis to the Outreach Feedback Loop specialist",
        "require approval for external send actions",
      ],
    }),
    actions: JSON.stringify({
      maySpawnSpecialists: true,
      approvalForExternalSends: true,
      summaryStyle: "brief-with-next-steps",
    }),
  }).run();
  console.log("Seeded Chief of Staff delegation policy.");
}

const existingTrigger = db.select().from(schema.triggers).where(
  eq(schema.triggers.id, DAILY_STANDUP_TRIGGER_ID)
).get();

if (!existingTrigger) {
  db.insert(schema.triggers).values({
    id: DAILY_STANDUP_TRIGGER_ID,
    tenantId: TENANT_ID,
    name: "Daily Chief of Staff Review",
    type: "cron",
    status: "active",
    targetType: "chief_of_staff",
    targetId: CHIEF_OF_STAFF_AGENT_ID,
    filterConfig: JSON.stringify({}),
    scheduleConfig: JSON.stringify({
      cron: "0 8 * * 1-5",
      timezone: "UTC",
      purpose: "Review goals, runs, blockers, and pending approvals each weekday morning.",
    }),
    dedupeKeyStrategy: "day",
  }).run();
  console.log("Seeded Chief of Staff daily review trigger.");
}

const existingOutreachPolicy = db.select().from(schema.policies).where(
  eq(schema.policies.id, OUTREACH_WAKE_POLICY_ID)
).get();

if (!existingOutreachPolicy) {
  db.insert(schema.policies).values({
    id: OUTREACH_WAKE_POLICY_ID,
    tenantId: TENANT_ID,
    name: "Outreach Feedback Wake Policy",
    type: "trigger",
    scope: "global",
    targetAgentId: FEEDBACK_AGENT_ID,
    conditions: JSON.stringify({
      source: "cron_or_event",
      domain: "outreach_feedback",
    }),
    actions: JSON.stringify({
      delegateToAgentId: FEEDBACK_AGENT_ID,
      inputPrefix: "Review recent outreach responses, update effectiveness tracking, and write any durable insights to shared memory.",
    }),
  }).run();
  console.log("Seeded outreach wake policy.");
}

const existingOutreachTrigger = db.select().from(schema.triggers).where(
  eq(schema.triggers.id, OUTREACH_WAKE_TRIGGER_ID)
).get();

if (!existingOutreachTrigger) {
  db.insert(schema.triggers).values({
    id: OUTREACH_WAKE_TRIGGER_ID,
    tenantId: TENANT_ID,
    name: "Daily Outreach Feedback Review",
    type: "cron",
    status: "active",
    targetType: "policy",
    targetId: OUTREACH_WAKE_POLICY_ID,
    filterConfig: JSON.stringify({
      domain: "outreach",
    }),
    scheduleConfig: JSON.stringify({
      cron: "0 9 * * 1-5",
      timezone: "UTC",
      purpose: "Check for outreach replies, update response tracking, and summarize what is changing.",
    }),
    dedupeKeyStrategy: "day",
  }).run();
  console.log("Seeded outreach feedback trigger.");
}

const existingTelegramPolicy = db.select().from(schema.policies).where(
  eq(schema.policies.id, TELEGRAM_TRIAGE_POLICY_ID)
).get();

if (!existingTelegramPolicy) {
  db.insert(schema.policies).values({
    id: TELEGRAM_TRIAGE_POLICY_ID,
    tenantId: TENANT_ID,
    name: "Important Telegram Message Triage",
    type: "trigger",
    scope: "global",
    targetAgentId: CHIEF_OF_STAFF_AGENT_ID,
    conditions: JSON.stringify({
      source: "telegram",
      highSignal: true,
    }),
    actions: JSON.stringify({
      delegateToAgentId: CHIEF_OF_STAFF_AGENT_ID,
      inputPrefix: "An important Telegram message arrived. Triage it, decide whether follow-up tasks or delegation are needed, and record durable next actions if appropriate.",
    }),
  }).run();
  console.log("Seeded Telegram triage policy.");
}

const existingTelegramTrigger = db.select().from(schema.triggers).where(
  eq(schema.triggers.id, TELEGRAM_IMPORTANT_TRIGGER_ID)
).get();

if (!existingTelegramTrigger) {
  db.insert(schema.triggers).values({
    id: TELEGRAM_IMPORTANT_TRIGGER_ID,
    tenantId: TENANT_ID,
    name: "Important Telegram Messages",
    type: "telegram",
    status: "active",
    targetType: "policy",
    targetId: TELEGRAM_TRIAGE_POLICY_ID,
    filterConfig: JSON.stringify({
      source: "telegram",
      excludeCommands: true,
      keywords: ["urgent", "asap", "blocked", "incident", "customer", "refund", "outage"],
    }),
    scheduleConfig: JSON.stringify({}),
    dedupeKeyStrategy: "message_id",
  }).run();
  console.log("Seeded Telegram important message trigger.");
}

const existingWebhookPolicy = db.select().from(schema.policies).where(
  eq(schema.policies.id, WEBHOOK_CRM_POLICY_ID)
).get();

if (!existingWebhookPolicy) {
  db.insert(schema.policies).values({
    id: WEBHOOK_CRM_POLICY_ID,
    tenantId: TENANT_ID,
    name: "CRM Webhook Triage",
    type: "trigger",
    scope: "global",
    targetAgentId: CHIEF_OF_STAFF_AGENT_ID,
    conditions: JSON.stringify({
      source: "webhook",
      eventTypes: ["crm.high_value_deal_updated"],
    }),
    actions: JSON.stringify({
      delegateToAgentId: CHIEF_OF_STAFF_AGENT_ID,
      inputPrefix: "A CRM webhook event indicates a high-value deal changed state. Review it, determine follow-up actions, and create approval-gated tasks where external action is needed.",
    }),
  }).run();
  console.log("Seeded CRM webhook policy.");
}

const existingWebhookTrigger = db.select().from(schema.triggers).where(
  eq(schema.triggers.id, WEBHOOK_CRM_TRIGGER_ID)
).get();

if (!existingWebhookTrigger) {
  db.insert(schema.triggers).values({
    id: WEBHOOK_CRM_TRIGGER_ID,
    tenantId: TENANT_ID,
    name: "CRM High Value Deal Webhook",
    type: "webhook",
    status: "active",
    targetType: "policy",
    targetId: WEBHOOK_CRM_POLICY_ID,
    filterConfig: JSON.stringify({
      source: "webhook",
      eventTypes: ["crm.high_value_deal_updated"],
    }),
    scheduleConfig: JSON.stringify({}),
    dedupeKeyStrategy: "external_event_id",
  }).run();
  console.log("Seeded CRM webhook trigger.");
}

const existingDemoTask = db.select().from(schema.tasks).where(
  eq(schema.tasks.id, DEMO_OUTBOUND_TASK_ID)
).get();

if (!existingDemoTask) {
  db.insert(schema.tasks).values({
    id: DEMO_OUTBOUND_TASK_ID,
    tenantId: TENANT_ID,
    title: "Approve migration outreach for Multiplay studios",
    description: "Review the prepared migration sequence for newly qualified Multiplay prospects and approve the first send batch.",
    status: "todo",
    source: "plan",
    approvalMode: "before_send",
    approvalStatus: "pending",
    assigneeType: "agent",
    assigneeId: CHIEF_OF_STAFF_AGENT_ID,
    priority: "high",
    position: 1000,
    tags: JSON.stringify(["outbound", "migration", "approval"]),
  }).run();
  console.log("Seeded demo outbound approval task.");
}

const existingSignalTask = db.select().from(schema.tasks).where(
  eq(schema.tasks.id, DEMO_SIGNAL_TASK_ID)
).get();

if (!existingSignalTask) {
  db.insert(schema.tasks).values({
    id: DEMO_SIGNAL_TASK_ID,
    tenantId: TENANT_ID,
    title: "Review shutdown signals from Hathora and Steam communities",
    description: "Triage the latest competitor displacement signals and decide which accounts should move into warm outreach.",
    status: "todo",
    source: "trigger",
    approvalMode: "before_run",
    approvalStatus: "pending",
    assigneeType: "agent",
    assigneeId: CHIEF_OF_STAFF_AGENT_ID,
    priority: "medium",
    position: 2000,
    tags: JSON.stringify(["signals", "competitors", "approval"]),
  }).run();
  console.log("Seeded demo signal review task.");
}

const existingTelegramConversation = db.select().from(schema.copilotConversations).where(
  eq(schema.copilotConversations.id, DEMO_TELEGRAM_CONVERSATION_ID)
).get();

if (!existingTelegramConversation) {
  db.insert(schema.copilotConversations).values({
    id: DEMO_TELEGRAM_CONVERSATION_ID,
    tenantId: TENANT_ID,
    ownerAgentId: CHIEF_OF_STAFF_AGENT_ID,
    title: "telegram:founder escalation",
  }).run();

  console.log("Seeded demo Telegram conversation.");
}

ensureConversationMessages(DEMO_TELEGRAM_CONVERSATION_ID, [
  {
    role: "user",
    content: "Urgent: can we prioritize studios leaving Multiplay this week?",
  },
  {
    role: "assistant",
    content: "Yes. I have elevated migration opportunities and queued approvals for the first outreach batch.",
  },
]);

const existingWebhookConversation = db.select().from(schema.copilotConversations).where(
  eq(schema.copilotConversations.id, DEMO_WEBHOOK_CONVERSATION_ID)
).get();

if (!existingWebhookConversation) {
  db.insert(schema.copilotConversations).values({
    id: DEMO_WEBHOOK_CONVERSATION_ID,
    tenantId: TENANT_ID,
    ownerAgentId: CHIEF_OF_STAFF_AGENT_ID,
    title: "webhook:crm.high_value_deal_updated",
  }).run();

  console.log("Seeded demo webhook conversation.");
}

ensureConversationMessages(DEMO_WEBHOOK_CONVERSATION_ID, [
  {
    role: "user",
    content: "High-value deal changed state: Gameforge moved to evaluation after infra review.",
  },
  {
    role: "assistant",
    content: "I created a follow-up task and updated the queue to prioritize related migration opportunities.",
  },
]);

const existingTemplate = db.select().from(schema.outreachTemplates).where(
  eq(schema.outreachTemplates.id, DEMO_TEMPLATE_ID)
).get();

if (!existingTemplate) {
  db.insert(schema.outreachTemplates).values({
    id: DEMO_TEMPLATE_ID,
    tenantId: TENANT_ID,
    name: "Competitor displacement outreach",
    subject: "Worth comparing migration options before your current platform sunsets?",
    body: "Hi {{contact_name}}, noticed {{company}} may be re-evaluating hosting after recent platform changes...",
    channel: "email",
    tags: JSON.stringify(["migration", "multiplay", "hathora"]),
    status: "active",
  }).run();
  console.log("Seeded demo outreach template.");
}

const existingOpportunityOne = db.select().from(schema.opportunities).where(
  eq(schema.opportunities.id, DEMO_OPPORTUNITY_1_ID)
).get();

const opportunityOneValues = {
  title: "Multiplay migration lead: Emberforge",
  accountName: "Emberforge",
  primaryContactName: "Alex Mercer",
  primaryContactEmail: "alex@emberforge.dev",
  primaryContactLinkedin: "https://linkedin.com/in/alex-mercer-dev",
  opportunityType: "signal",
  status: "queued",
  primaryPath: "cold",
  score: 92,
  confidence: 88,
  rationaleSummary: "The studio appears to be operating a live multiplayer title and is publicly preparing for a hosting migration.",
  sourceSummary: "Website and community signals point to an active Multiplay migration for a live co-op action game.",
  freshestSignalAt: new Date().toISOString(),
  metadata: JSON.stringify({
    seeded: true,
    campaign: "multiplay-displacement",
    product: "A live co-op action game with dedicated server hosting requirements.",
    liveStatus: "Live in market",
    painPoints: ["Needs to migrate live server infrastructure off Multiplay without disrupting active players."],
    whyNow: "The team posted a migration prep update after Multiplay shutdown pressure increased.",
    proof: "Community and website posts both mention moving dedicated server infrastructure.",
  }),
};

if (!existingOpportunityOne) {
  db.insert(schema.opportunities).values({
    id: DEMO_OPPORTUNITY_1_ID,
    tenantId: TENANT_ID,
    ...opportunityOneValues,
  }).run();
} else {
  db.update(schema.opportunities)
    .set(opportunityOneValues)
    .where(eq(schema.opportunities.id, DEMO_OPPORTUNITY_1_ID))
    .run();
}

db.delete(schema.opportunitySources)
  .where(eq(schema.opportunitySources.opportunityId, DEMO_OPPORTUNITY_1_ID))
  .run();
db.insert(schema.opportunitySources).values([
  {
    id: ulid(),
    tenantId: TENANT_ID,
    opportunityId: DEMO_OPPORTUNITY_1_ID,
    sourceType: "website",
    sourceRef: "emberforge-shutdown-post",
    freshnessScore: 0.96,
    rawSummary: "Studio published a post about preparing to migrate the live hosting stack for its co-op action game.",
    sourceEvidence: JSON.stringify({
      domain: "emberforge.dev",
      product: "A live co-op action game with dedicated server hosting requirements.",
      liveStatus: "Live in market",
      painPoints: ["Preparing a live migration off Multiplay without service disruption."],
      whyNow: "The studio published a migration-prep note after renewed platform sunset concerns.",
      proof: "Website update described moving dedicated servers for the live game.",
    }),
    ingestedAt: new Date().toISOString(),
  },
  {
    id: ulid(),
    tenantId: TENANT_ID,
    opportunityId: DEMO_OPPORTUNITY_1_ID,
    sourceType: "community",
    sourceRef: "discord-emberforge-multiplay-thread",
    freshnessScore: 0.82,
    rawSummary: "Community moderator said the team is evaluating replacement dedicated-server vendors for the live title.",
    sourceEvidence: JSON.stringify({
      channel: "discord",
      product: "A live co-op action game with dedicated server hosting requirements.",
      liveStatus: "Live in market",
      painPoints: ["Vendor migration for live dedicated servers."],
    }),
    ingestedAt: new Date().toISOString(),
  },
]).run();
db.delete(schema.opportunityDrafts)
  .where(eq(schema.opportunityDrafts.opportunityId, DEMO_OPPORTUNITY_1_ID))
  .run();
db.insert(schema.opportunityDrafts).values({
  id: ulid(),
  tenantId: TENANT_ID,
  opportunityId: DEMO_OPPORTUNITY_1_ID,
  draftType: "cold_email",
  subject: "Worth comparing migration options before Multiplay winds down?",
  content: "Alex — saw the migration chatter around Emberforge. We help studios move fast without rebuilding their server orchestration from scratch.",
  modelRef: "seeded-demo",
  status: "generated",
}).run();
db.delete(schema.opportunitySyncEvents)
  .where(eq(schema.opportunitySyncEvents.opportunityId, DEMO_OPPORTUNITY_1_ID))
  .run();
db.insert(schema.opportunitySyncEvents).values({
  id: ulid(),
  tenantId: TENANT_ID,
  opportunityId: DEMO_OPPORTUNITY_1_ID,
  targetSystem: "attio",
  actionType: "create_contact",
  status: "success",
  externalRef: "attio-person-emberforge",
  payloadSummary: "Created contact and attached migration-signal note.",
}).run();
console.log("Seeded demo opportunity: Emberforge.");

const existingOpportunityTwo = db.select().from(schema.opportunities).where(
  eq(schema.opportunities.id, DEMO_OPPORTUNITY_2_ID)
).get();

const opportunityTwoValues = {
  title: "Warm intro candidate: Lanternbyte",
  accountName: "Lanternbyte",
  primaryContactName: "Priya Shah",
  primaryContactEmail: "priya@lanternbyte.games",
  primaryContactLinkedin: "https://linkedin.com/in/priya-shah-games",
  opportunityType: "outbound",
  status: "intro_candidate",
  primaryPath: "warm",
  score: 95,
  confidence: 91,
  rationaleSummary: "Qualified because the team is building a session-based multiplayer game and is re-evaluating backend hosting after Hathora's shutdown.",
  sourceSummary: "Apollo import identified the backend lead for a multiplayer extraction title, with a confirmed warm intro and clear migration timing.",
  freshestSignalAt: new Date().toISOString(),
  metadata: JSON.stringify({
    seeded: true,
    campaign: "hathora-displacement",
    product: "A session-based multiplayer extraction game that relies on dedicated game servers.",
    liveStatus: "Pre-launch with multiplayer playtests underway",
    painPoints: ["Needs a new dedicated server provider after Hathora shutdown.", "Backend team is actively evaluating migration options before the next test."],
    whyNow: "Their backend lead is discussing infrastructure alternatives during the current hosting vendor transition window.",
    proof: "Apollo profile plus intro path point to the backend owner right as the team is planning the migration.",
  }),
};

if (!existingOpportunityTwo) {
  db.insert(schema.opportunities).values({
    id: DEMO_OPPORTUNITY_2_ID,
    tenantId: TENANT_ID,
    ...opportunityTwoValues,
  }).run();
} else {
  db.update(schema.opportunities)
    .set(opportunityTwoValues)
    .where(eq(schema.opportunities.id, DEMO_OPPORTUNITY_2_ID))
    .run();
}

db.delete(schema.opportunitySources)
  .where(eq(schema.opportunitySources.opportunityId, DEMO_OPPORTUNITY_2_ID))
  .run();
db.insert(schema.opportunitySources).values({
  id: ulid(),
  tenantId: TENANT_ID,
  opportunityId: DEMO_OPPORTUNITY_2_ID,
  sourceType: "apollo",
  sourceRef: "apollo-lanternbyte-priya",
  freshnessScore: 0.91,
  rawSummary: "Backend lead for a multiplayer extraction game is evaluating infra alternatives after Hathora shutdown.",
  sourceEvidence: JSON.stringify({
    provider: "apollo",
    product: "A session-based multiplayer extraction game that relies on dedicated game servers.",
    liveStatus: "Pre-launch with multiplayer playtests underway",
    painPoints: ["Needs a Hathora replacement before the next multiplayer playtest."],
    whyNow: "Infrastructure vendor decision is active now, before the next test window.",
    proof: "Apollo notes identify Priya as the backend lead for multiplayer infrastructure decisions.",
  }),
  ingestedAt: new Date().toISOString(),
}).run();
db.delete(schema.introPaths)
  .where(eq(schema.introPaths.opportunityId, DEMO_OPPORTUNITY_2_ID))
  .run();
db.insert(schema.introPaths).values({
  id: ulid(),
  tenantId: TENANT_ID,
  opportunityId: DEMO_OPPORTUNITY_2_ID,
  connectorType: "imported_network",
  mutualRef: "mutual-jamie-ross",
  mutualName: "Jamie Ross",
  pathSummary: "Jamie Ross knows Priya from the GDC infra roundtable and can broker a warm intro.",
  confidence: 87,
  freshness: 84,
  status: "available",
  evidence: JSON.stringify({ relationship: "former customer contact" }),
}).run();
db.delete(schema.opportunityDrafts)
  .where(eq(schema.opportunityDrafts.opportunityId, DEMO_OPPORTUNITY_2_ID))
  .run();
db.insert(schema.opportunityDrafts).values({
  id: ulid(),
  tenantId: TENANT_ID,
  opportunityId: DEMO_OPPORTUNITY_2_ID,
  draftType: "intro_request",
  subject: "Can you intro us to Priya at Lanternbyte?",
  content: "Jamie — Priya looks like a strong fit for Gameye after the recent platform changes. Would you be comfortable making a quick intro?",
  modelRef: "seeded-demo",
  status: "generated",
}).run();
console.log("Seeded demo opportunity: Lanternbyte.");

const existingOpportunityThree = db.select().from(schema.opportunities).where(
  eq(schema.opportunities.id, DEMO_OPPORTUNITY_3_ID)
).get();

const opportunityThreeValues = {
  title: "Follow-up in flight: Northstar Arcade",
  accountName: "Northstar Arcade",
  primaryContactName: "Mina Park",
  primaryContactEmail: "mina@northstararcade.com",
  primaryContactLinkedin: "https://linkedin.com/in/mina-park-arcade",
  opportunityType: "outbound",
  status: "active_followup",
  primaryPath: "cold",
  score: 81,
  confidence: 79,
  rationaleSummary: "The account is already engaged and needs a specific follow-up around live migration planning and cost control.",
  sourceSummary: "Existing outbound account with a positive reply from a live multiplayer game team.",
  freshestSignalAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  metadata: JSON.stringify({
    seeded: true,
    followUpStage: 2,
    product: "A live multiplayer arcade game with dedicated server usage.",
    liveStatus: "Live in market",
    painPoints: ["Wants a concrete migration plan and clearer live-ops cost profile."],
    whyNow: "The prospect replied and asked for specifics on migration effort and ongoing cost.",
    proof: "Positive reply already received from the operator contact.",
  }),
};

if (!existingOpportunityThree) {
  db.insert(schema.opportunities).values({
    id: DEMO_OPPORTUNITY_3_ID,
    tenantId: TENANT_ID,
    ...opportunityThreeValues,
  }).run();
} else {
  db.update(schema.opportunities)
    .set(opportunityThreeValues)
    .where(eq(schema.opportunities.id, DEMO_OPPORTUNITY_3_ID))
    .run();
}

db.delete(schema.opportunitySources)
  .where(eq(schema.opportunitySources.opportunityId, DEMO_OPPORTUNITY_3_ID))
  .run();
db.insert(schema.opportunitySources).values({
  id: ulid(),
  tenantId: TENANT_ID,
  opportunityId: DEMO_OPPORTUNITY_3_ID,
  sourceType: "manual",
  sourceRef: "northstar-followup-seed",
  freshnessScore: 0.74,
  rawSummary: "Operator-confirmed follow-up after a positive reply asking about migration effort and live-ops costs.",
  sourceEvidence: JSON.stringify({
    owner: "chief-of-staff",
    product: "A live multiplayer arcade game with dedicated server usage.",
    liveStatus: "Live in market",
    painPoints: ["Needs migration plan clarity.", "Wants cost savings for ongoing live-ops infrastructure."],
    whyNow: "They have already replied and want concrete follow-up.",
    proof: "Positive reply is already logged on the account.",
  }),
  ingestedAt: new Date().toISOString(),
}).run();
console.log("Seeded demo opportunity: Northstar Arcade.");

const seededSend = db.select().from(schema.outreachSends).where(
  eq(schema.outreachSends.templateId, DEMO_TEMPLATE_ID)
).get();

if (!seededSend) {
  const sendIds = Array.from({ length: 6 }, (_, index) => `01SENDDEMO${index.toString().padStart(2, "0")}000000000`);
  db.insert(schema.outreachSends).values(
    sendIds.map((id, index) => ({
      id,
      tenantId: TENANT_ID,
      templateId: DEMO_TEMPLATE_ID,
      contactRef: `attio-demo-contact-${index + 1}`,
      contactName: `Demo Contact ${index + 1}`,
      companyName: index < 3 ? "Multiplay Studio" : "Hathora Studio",
      channel: "email",
      icpSegment: "game-studio",
      metadata: JSON.stringify({ seeded: true }),
    }))
  ).run();

  db.insert(schema.outreachResponses).values([
    {
      id: ulid(),
      tenantId: TENANT_ID,
      sendId: sendIds[0],
      responseType: "reply",
      sentiment: "positive",
      notes: "Asked for migration comparison details.",
    },
    {
      id: ulid(),
      tenantId: TENANT_ID,
      sendId: sendIds[1],
      responseType: "meeting_booked",
      sentiment: "positive",
      notes: "Booked a call for Friday.",
    },
  ]).run();
  console.log("Seeded demo outreach learning data.");
}

const todaySnapshotDate = new Date().toISOString().slice(0, 10);
const existingSnapshot = db.select().from(schema.briefingSnapshots).where(
  and(
    eq(schema.briefingSnapshots.tenantId, TENANT_ID),
    eq(schema.briefingSnapshots.snapshotDate, todaySnapshotDate),
  )
).get();

const briefingSummary = `## Morning Brief

You have **2 high-confidence opportunities** ready for review this morning.
One warm intro path is available and should be considered before cold outreach.
There are **2 approval-gated tasks** waiting in the Inbox.
Recent migration and shutdown signals are being converted into ranked outbound work.
`;

if (!existingSnapshot) {
  db.insert(schema.briefingSnapshots).values({
    id: ulid(),
    tenantId: TENANT_ID,
    snapshotDate: todaySnapshotDate,
    status: "ready",
    summaryMarkdown: briefingSummary,
    structuredPayload: JSON.stringify({
      seeded: true,
      topOpportunityId: DEMO_OPPORTUNITY_2_ID,
    }),
    queueCount: 2,
    topOpportunityId: DEMO_OPPORTUNITY_2_ID,
    freshnessLabel: "fresh",
    generatedAt: new Date().toISOString(),
  }).run();
  console.log("Seeded demo briefing snapshot.");
} else {
  db.update(schema.briefingSnapshots)
    .set({
      status: "ready",
      summaryMarkdown: briefingSummary,
      structuredPayload: JSON.stringify({
        seeded: true,
        topOpportunityId: DEMO_OPPORTUNITY_2_ID,
      }),
      queueCount: 2,
      topOpportunityId: DEMO_OPPORTUNITY_2_ID,
      freshnessLabel: "fresh",
      generatedAt: new Date().toISOString(),
    })
    .where(eq(schema.briefingSnapshots.id, existingSnapshot.id))
    .run();
  console.log("Updated demo briefing snapshot.");
}

pruneDuplicateEmptyConversations();

console.log("Seed complete.");
sqlite.close();
