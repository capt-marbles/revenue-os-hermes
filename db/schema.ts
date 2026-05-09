import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ─── Tenants ─────────────────────────────────────────────────────────────────
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: text("settings").default("{}"), // JSON
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Desks ───────────────────────────────────────────────────────────────────
export const desks = sqliteTable("desks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  persona: text("persona"), // Custom system prompt for the desk's Co-Pilot
  icon: text("icon"), // lucide icon name
  color: text("color"), // tailwind color class
  global: integer("global").default(0), // 1 = sees data across all desks
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("desks_tenant_slug").on(table.tenantId, table.slug),
]);

// ─── Desk Agents (junction) ─────────────────────────────────────────────────
export const deskAgents = sqliteTable("desk_agents", {
  deskId: text("desk_id").notNull().references(() => desks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
}, (table) => [
  uniqueIndex("desk_agents_unique").on(table.deskId, table.agentId),
]);

// ─── Goals ───────────────────────────────────────────────────────────────────
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  deskId: text("desk_id").references(() => desks.id), // null = global
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active | achieved | paused | archived
  targetMetric: text("target_metric"),
  targetValue: real("target_value"),
  currentValue: real("current_value").default(0),
  unit: text("unit"),
  deadline: text("deadline"),
  priority: integer("priority").default(0),
  approvalMode: text("approval_mode").default("each"), // each | auto — controls whether tasks need per-task approval
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Tasks ───────────────────────────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  deskId: text("desk_id").references(() => desks.id), // null = global
  goalId: text("goal_id").references(() => goals.id),
  parentTaskId: text("parent_task_id"), // Self-referential — subtask of another task (max depth 2)
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("backlog"), // backlog | todo | in_progress | done | blocked
  source: text("source").notNull().default("manual"), // manual | plan | trigger | policy | webhook
  approvalMode: text("approval_mode").notNull().default("none"), // none | before_run | before_send | before_close
  approvalStatus: text("approval_status").notNull().default("approved"), // pending | approved | rejected | redirected
  assigneeType: text("assignee_type").default("unassigned"), // human | agent | unassigned
  assigneeId: text("assignee_id"), // FK agents.id when assignee_type='agent'
  priority: text("priority").default("medium"), // low | medium | high | urgent
  position: integer("position").default(0),
  depth: integer("depth").default(0), // 0 = top-level task, 1 = subtask, 2 = sub-subtask
  timeoutSeconds: integer("timeout_seconds"), // null = use default (300s). Director can set per task.
  dueDate: text("due_date"),
  tags: text("tags").default("[]"), // JSON array
  hermesTaskId: text("hermes_task_id"), // Linked Hermes Kanban task ID
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Agents ──────────────────────────────────────────────────────────────────
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  agentType: text("agent_type").notNull().default("specialist"), // chief_of_staff | specialist
  source: text("source").notNull(), // marketing-skills | agency-agents | custom
  sourceRef: text("source_ref"), // skill name or file path
  description: text("description"),
  capabilities: text("capabilities").default("[]"), // JSON array
  systemPrompt: text("system_prompt"),
  model: text("model").default("sonnet"),
  tools: text("tools").default("[]"), // JSON array
  status: text("status").default("idle"), // idle | running | disabled | error
  config: text("config").default("{}"), // JSON
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("agents_tenant_slug").on(table.tenantId, table.slug),
]);

// ─── Agent Runs ──────────────────────────────────────────────────────────────
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  taskId: text("task_id").references(() => tasks.id),
  status: text("status").notNull().default("queued"), // queued | running | success | failed | cancelled
  trigger: text("trigger").default("manual"), // manual | scheduled | goal-decomposition
  input: text("input"), // JSON
  output: text("output"), // JSON
  error: text("error"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  durationMs: integer("duration_ms"),
  tokensUsed: integer("tokens_used"),
  costEstimate: real("cost_estimate"),
  pipelineConfigId: text("pipeline_config_id").references(() => pipelineConfigs.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Shared Memory ───────────────────────────────────────────────────────────
export const sharedMemory = sqliteTable("shared_memory", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  layer: text("layer").notNull().default("global"), // global | goal | agent | task | run
  scopeRefId: text("scope_ref_id").notNull().default(""),
  category: text("category").notNull(), // icp | brand_voice | tools | connectors | competitors | custom
  key: text("key").notNull(),
  value: text("value").notNull(), // markdown or JSON
  updatedBy: text("updated_by"), // 'human' | agent slug
  confidence: real("confidence").default(1),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("memory_tenant_layer_scope_category_key").on(
    table.tenantId,
    table.layer,
    table.scopeRefId,
    table.category,
    table.key,
  ),
]);

// ─── Connectors ──────────────────────────────────────────────────────────────
export const connectors = sqliteTable("connectors", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // mcp | api_key | oauth | webhook
  config: text("config").default("{}"), // JSON
  status: text("status").default("disconnected"), // connected | disconnected | error
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Co-Pilot Conversations ─────────────────────────────────────────────────
export const copilotConversations = sqliteTable("copilot_conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  deskId: text("desk_id").references(() => desks.id), // null = global Co-Pilot
  ownerAgentId: text("owner_agent_id").references(() => agents.id),
  title: text("title"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Co-Pilot Messages ──────────────────────────────────────────────────────
export const copilotMessages = sqliteTable("copilot_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => copilotConversations.id),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  status: text("status").default("done"), // pending | done | error
  briefingSnapshot: text("briefing_snapshot"), // JSON — system state at time of message
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Co-Pilot Action Decisions ──────────────────────────────────────────────
export const copilotActionDecisions = sqliteTable("copilot_action_decisions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  conversationId: text("conversation_id").notNull().references(() => copilotConversations.id),
  messageId: text("message_id").notNull().references(() => copilotMessages.id),
  actionKey: text("action_key").notNull(),
  status: text("status").notNull(), // approved | dismissed
  resultMessage: text("result_message"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("copilot_action_decisions_unique").on(
    table.tenantId,
    table.messageId,
    table.actionKey,
  ),
]);

// ─── Documents ───────────────────────────────────────────────────────────────
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  deskId: text("desk_id").references(() => desks.id), // null = global
  title: text("title").notNull(),
  content: text("content").notNull(), // The agent's output — markdown/text
  summary: text("summary"), // Short summary for list views
  agentId: text("agent_id").references(() => agents.id),
  agentRunId: text("agent_run_id").references(() => agentRuns.id),
  taskId: text("task_id").references(() => tasks.id),
  tags: text("tags").default("[]"), // JSON array
  sequenceRunId: text("sequence_run_id"), // Links doc to a sequence execution
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Document Replies ────────────────────────────────────────────────────────
export const documentReplies = sqliteTable("document_replies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Sequences ──────────────────────────────────────────────────────────────
export const sequences = sqliteTable("sequences", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft | active | archived
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Sequence Steps ─────────────────────────────────────────────────────────
export const sequenceSteps = sqliteTable("sequence_steps", {
  id: text("id").primaryKey(),
  sequenceId: text("sequence_id").notNull().references(() => sequences.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  position: integer("position").notNull().default(0),
  group: integer("group").notNull().default(0), // Steps with same group run in parallel
  name: text("name").notNull(),
  promptTemplate: text("prompt_template").notNull(), // Supports {{previous_output}}, {{sequence_input}}
  config: text("config").default("{}"), // JSON
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Sequence Runs ──────────────────────────────────────────────────────────
export const sequenceRuns = sqliteTable("sequence_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  sequenceId: text("sequence_id").notNull().references(() => sequences.id),
  status: text("status").notNull().default("queued"), // queued | running | success | failed | cancelled
  input: text("input"),
  currentStep: integer("current_step").default(0),
  totalSteps: integer("total_steps").default(0),
  taskId: text("task_id").references(() => tasks.id),
  error: text("error"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Schedules ───────────────────────────────────────────────────────────────
export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(), // agent | sequence
  targetId: text("target_id").notNull(), // agent ID or sequence ID
  input: text("input").notNull(), // The prompt/input to pass when triggered
  cron: text("cron").notNull(), // Cron expression (e.g., "0 9 * * 1" = Mondays at 9am)
  timezone: text("timezone").default("UTC"),
  enabled: integer("enabled").notNull().default(1), // 1 = active, 0 = paused
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at"),
  runCount: integer("run_count").default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Policies ────────────────────────────────────────────────────────────────
export const policies = sqliteTable("policies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // delegation | spawn | approval | trigger | memory
  scope: text("scope").notNull().default("global"), // global | goal | agent | task_type
  targetAgentId: text("target_agent_id").references(() => agents.id),
  conditions: text("conditions").notNull().default("{}"), // JSON
  actions: text("actions").notNull().default("{}"), // JSON
  enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Triggers ────────────────────────────────────────────────────────────────
export const triggers = sqliteTable("triggers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // cron | email | webhook | crm_event | document_change | manual | telegram
  status: text("status").notNull().default("active"), // active | paused | error
  targetType: text("target_type").notNull(), // chief_of_staff | specialist | policy
  targetId: text("target_id").notNull(),
  filterConfig: text("filter_config").notNull().default("{}"), // JSON
  scheduleConfig: text("schedule_config").notNull().default("{}"), // JSON
  dedupeKeyStrategy: text("dedupe_key_strategy").default(""),
  lastFiredAt: text("last_fired_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Pipeline Stage Actions ──────────────────────────────────────────────────
// Defines what agent runs when an opportunity transitions between statuses.
// from_status='*' matches any incoming status (wildcard trigger).
export const pipelineStageActions = sqliteTable("pipeline_stage_actions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  fromStatus: text("from_status").notNull().default("*"),
  toStatus: text("to_status").notNull(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  promptTemplate: text("prompt_template").notNull(),
  autoApprove: integer("auto_approve").notNull().default(0), // 1 = skip human approval
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("active"), // active | paused
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Opportunities ───────────────────────────────────────────────────────────
export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  goalId: text("goal_id").references(() => goals.id),
  title: text("title").notNull(),
  accountName: text("account_name"),
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactLinkedin: text("primary_contact_linkedin"),
  opportunityType: text("opportunity_type").notNull().default("outbound"), // outbound | inbound | signal
  status: text("status").notNull().default("discovered"), // discovered | enriched | scored | queued | drafted | approved | synced | demo_scheduled | demo_completed | evaluation_period | technical_evaluation | committed | won | lost | active_followup | intro_candidate | intro_requested | intro_made | won_intro | sent_cold | disqualified | archived
  primaryPath: text("primary_path").notNull().default("none"), // cold | warm | none
  score: real("score").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  rationaleSummary: text("rationale_summary"),
  sourceSummary: text("source_summary"),
  freshestSignalAt: text("freshest_signal_at"),
  lastActivityAt: text("last_activity_at"),
  attioRecordRef: text("attio_record_ref"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("opportunities_tenant_title_account_contact").on(
    table.tenantId,
    table.title,
    table.accountName,
    table.primaryContactEmail,
  ),
]);

export const opportunitySources = sqliteTable("opportunity_sources", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id),
  sourceType: text("source_type").notNull(), // apollo | phantombuster | steam_bridge | website | youtube | crm | manual
  sourceRef: text("source_ref").notNull(),
  payloadFingerprint: text("payload_fingerprint"),
  freshnessScore: real("freshness_score").notNull().default(0),
  rawSummary: text("raw_summary"),
  sourceEvidence: text("source_evidence").notNull().default("{}"),
  ingestedAt: text("ingested_at").notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("opportunity_sources_unique_ref").on(
    table.tenantId,
    table.sourceType,
    table.sourceRef,
  ),
]);

export const introPaths = sqliteTable("intro_paths", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id),
  connectorType: text("connector_type").notNull(), // linkedin | crm | imported_network
  mutualRef: text("mutual_ref"),
  mutualName: text("mutual_name"),
  pathSummary: text("path_summary").notNull(),
  confidence: real("confidence").notNull().default(0),
  freshness: real("freshness").notNull().default(0),
  status: text("status").notNull().default("available"), // available | stale | requested | made | dismissed
  evidence: text("evidence").notNull().default("{}"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const opportunityDrafts = sqliteTable("opportunity_drafts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id),
  draftType: text("draft_type").notNull(), // cold_email | intro_request | follow_up
  subject: text("subject"),
  content: text("content").notNull(),
  modelRef: text("model_ref"),
  status: text("status").notNull().default("generated"), // generated | approved | rejected | sent
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const opportunitySyncEvents = sqliteTable("opportunity_sync_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id),
  targetSystem: text("target_system").notNull(), // attio | gmail | tasks
  actionType: text("action_type").notNull(), // create_contact | update_contact | create_note | create_draft | update_stage
  status: text("status").notNull().default("pending"), // pending | success | conflict | failed
  externalRef: text("external_ref"),
  payloadSummary: text("payload_summary"),
  errorClass: text("error_class"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const opportunityOutcomes = sqliteTable("opportunity_outcomes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id),
  outcomeType: text("outcome_type").notNull(), // reply | meeting_booked | intro_made | no_response | bounced | disqualified
  attributedSource: text("attributed_source"),
  attributedTemplate: text("attributed_template"),
  attributionConfidence: real("attribution_confidence").notNull().default(0),
  notes: text("notes"),
  recordedAt: text("recorded_at").notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const briefingSnapshots = sqliteTable("briefing_snapshots", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  snapshotDate: text("snapshot_date").notNull(),
  status: text("status").notNull().default("ready"), // ready | partial | failed
  summaryMarkdown: text("summary_markdown").notNull(),
  structuredPayload: text("structured_payload").notNull().default("{}"),
  queueCount: integer("queue_count").notNull().default(0),
  topOpportunityId: text("top_opportunity_id").references(() => opportunities.id),
  freshnessLabel: text("freshness_label").notNull().default("fresh"),
  generatedAt: text("generated_at").notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("briefing_snapshots_tenant_date").on(table.tenantId, table.snapshotDate),
]);

// ─── Outreach Templates ─────────────────────────────────────────────────────
export const outreachTemplates = sqliteTable("outreach_templates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(), // markdown template, supports {{contact_name}}, {{company}}, etc.
  channel: text("channel").notNull().default("email"), // email | linkedin
  version: integer("version").notNull().default(1),
  parentId: text("parent_id"), // self-reference for version tracking
  tags: text("tags").default("[]"), // JSON array — e.g., ["cold-outreach", "game-studio"]
  status: text("status").notNull().default("active"), // active | archived
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Outreach Sends ─────────────────────────────────────────────────────────
export const outreachSends = sqliteTable("outreach_sends", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  templateId: text("template_id").notNull().references(() => outreachTemplates.id),
  contactRef: text("contact_ref").notNull(), // external CRM contact ID (e.g., Attio record ID)
  contactName: text("contact_name"), // denormalized for quick display
  companyName: text("company_name"), // denormalized
  channel: text("channel").notNull().default("email"), // email | linkedin
  sentAt: text("sent_at").notNull().$defaultFn(() => new Date().toISOString()),
  agentRunId: text("agent_run_id").references(() => agentRuns.id), // which agent run sent this
  pipelineConfigId: text("pipeline_config_id").references(() => pipelineConfigs.id),
  icpSegment: text("icp_segment"), // e.g., "game-studio", "hosting-company" — for effectiveness analysis
  metadata: text("metadata").default("{}"), // JSON — extra context like subject line used, personalization vars
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Outreach Responses ─────────────────────────────────────────────────────
export const outreachResponses = sqliteTable("outreach_responses", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  sendId: text("send_id").notNull().references(() => outreachSends.id),
  responseType: text("response_type").notNull(), // reply | bounce | open | click | meeting_booked | unsubscribe
  sentiment: text("sentiment"), // positive | neutral | negative | null
  detectedAt: text("detected_at").notNull().$defaultFn(() => new Date().toISOString()),
  notes: text("notes"), // agent-generated summary of the response
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Pipeline Configs ───────────────────────────────────────────────────────
// Snapshots of agent prompts, scoring weights, thresholds, and source settings.
// Every agent run tags itself with the active config. Outcomes are attributed here.
export const pipelineConfigs = sqliteTable("pipeline_configs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(), // e.g. "gameye-multiplay-v2"
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft | active | archived
  config: text("config").notNull().default("{}"), // JSON — see PipelineConfig type
  activatedAt: text("activated_at"), // when this config became the active one
  deactivatedAt: text("deactivated_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Experiments ───────────────────────────────────────────────────────────
// A/B tests between two pipeline configs. CoS proposes, human approves.
export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  controlConfigId: text("control_config_id").notNull().references(() => pipelineConfigs.id),
  treatmentConfigId: text("treatment_config_id").notNull().references(() => pipelineConfigs.id),
  status: text("status").notNull().default("draft"), // draft | running | completed | cancelled
  splitPercent: integer("split_percent").notNull().default(50), // percent routed to treatment
  metricName: text("metric_name").notNull(), // e.g. "reply_rate", "meeting_booked"
  metricDirection: text("metric_direction").notNull().default("higher_is_better"), // higher_is_better | lower_is_better
  startDate: text("start_date"),
  endDate: text("end_date"),
  sampleSize: integer("sample_size").notNull().default(0),
  minSampleSize: integer("min_sample_size").notNull().default(50),
  controlMetricValue: real("control_metric_value"),
  treatmentMetricValue: real("treatment_metric_value"),
  confidence: real("confidence"), // statistical confidence level
  conclusion: text("conclusion"), // CoS-generated summary of results
  concludedAt: text("concluded_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Experiment Assignments ────────────────────────────────────────────────
// Tracks which opportunity/run was assigned to which experiment arm.
export const experimentAssignments = sqliteTable("experiment_assignments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  experimentId: text("experiment_id").notNull().references(() => experiments.id),
  arm: text("arm").notNull(), // control | treatment
  pipelineConfigId: text("pipeline_config_id").notNull().references(() => pipelineConfigs.id),
  entityType: text("entity_type").notNull(), // opportunity | send | run
  entityId: text("entity_id").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("exp_assign_entity").on(table.experimentId, table.entityType, table.entityId),
]);

// ─── CoS Insights ──────────────────────────────────────────────────────────
// Structured observations from the Chief of Staff. Never modifies agents directly.
export const cosInsights = sqliteTable("cos_insights", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  category: text("category").notNull(), // pattern | anomaly | recommendation | risk
  severity: text("severity").notNull().default("info"), // info | low | medium | high
  title: text("title").notNull(),
  detail: text("detail").notNull(), // markdown
  evidence: text("evidence").notNull().default("[]"), // JSON — linked opportunity/run/outcome IDs
  actionProposed: text("action_proposed"), // optional: what to do about it
  actionStatus: text("action_status"), // null | proposed | approved | dismissed | applied
  status: text("status").notNull().default("active"), // active | superseded | dismissed
  experimentId: text("experiment_id").references(() => experiments.id), // linked if from experiment
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Change Proposals ──────────────────────────────────────────────────────
// The write guard. Agents propose changes; humans approve. One-click rollback.
export const changeProposals = sqliteTable("change_proposals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  source: text("source").notNull(), // cos | human | experiment
  changeType: text("change_type").notNull(), // prompt | weights | threshold | memory | new_agent | source_config
  targetTable: text("target_table").notNull(), // which table/entity to modify
  targetId: text("target_id").notNull(), // which record to modify
  beforeState: text("before_state").notNull().default("{}"), // JSON — current value (for rollback)
  afterState: text("after_state").notNull().default("{}"), // JSON — proposed value
  experimentId: text("experiment_id").references(() => experiments.id), // if this came from an experiment
  status: text("status").notNull().default("proposed"), // proposed | approved | rejected | applied | rolled_back
  approvedBy: text("approved_by"),
  appliedBy: text("applied_by"),
  appliedAt: text("applied_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Audit Trail ─────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  deskId: text("desk_id").references(() => desks.id),
  action: text("action").notNull(), // create_task | update_goal | trigger_agent | update_memory | approve_action | etc.
  entity: text("entity").notNull(), // task | goal | agent | memory | document
  entityId: text("entity_id"), // ID of the affected entity
  summary: text("summary").notNull(), // Human-readable description
  source: text("source").notNull().default("operator"), // operator | copilot | agent | scheduler | telegram
  metadata: text("metadata").default("{}"), // JSON — extra context
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Agent Session State (resumption context) ──────────────────────────────
export const agentSessionState = sqliteTable("agent_session_state", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  taskId: text("task_id").references(() => tasks.id),
  sessionSummary: text("session_summary").notNull(), // Compacted context from prior runs
  turnCount: integer("turn_count").notNull().default(0), // Total turns across all runs
  lastRunId: text("last_run_id").references(() => agentRuns.id),
  lastRunStatus: text("last_run_status"), // success | failed
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("session_state_agent_task").on(table.tenantId, table.agentId, table.taskId),
]);

// ─── Director Wiki ───────────────────────────────────────────────────────────
export const directorWiki = sqliteTable("director_wiki", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  deskId: text("desk_id").notNull().references(() => desks.id),
  slug: text("slug").notNull(), // URL-safe identifier, e.g. "multiplay-competitor"
  title: text("title").notNull(), // Human-readable, e.g. "Multiplay (Competitor)"
  category: text("category").notNull(), // competitor | icp_segment | tactic | insight | process | reference
  content: text("content").notNull(), // Structured markdown body
  tags: text("tags").default("[]"), // JSON array for cross-referencing
  sourceRunIds: text("source_run_ids").default("[]"), // JSON array of agentRun IDs that contributed
  confidence: text("confidence").default("medium"), // low | medium | high
  lastReferencedAt: text("last_referenced_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("wiki_tenant_desk_slug").on(table.tenantId, table.deskId, table.slug),
]);

// ─── Autopilots ──────────────────────────────────────────────────────────────
export const autopilots = sqliteTable("autopilots", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  agentSlug: text("agent_slug").notNull(), // scout | outreach | steward | marketing | sales-engineering | chief-of-staff | leo
  prompt: text("prompt").notNull(),
  schedule: text("schedule").notNull(), // cron expression e.g. "0 6 * * *"
  mode: text("mode").notNull().default("run_only"), // run_only | create_task
  harness: text("harness").notNull().default("hermes"), // hermes | claude-code
  enabled: integer("enabled").notNull().default(1),
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at"),
  lastRunStatus: text("last_run_status"), // success | failed | running
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Autopilot Runs ───────────────────────────────────────────────────────────
export const autopilotRuns = sqliteTable("autopilot_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  autopilotId: text("autopilot_id").notNull().references(() => autopilots.id),
  status: text("status").notNull().default("queued"), // queued | running | success | failed
  trigger: text("trigger").notNull().default("scheduled"), // scheduled | manual
  prompt: text("prompt").notNull(),
  output: text("output"),
  error: text("error"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Deals ───────────────────────────────────────────────────────────────────
export const deals = sqliteTable("deals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  stage: text("stage").notNull().default("reachout"),
  salesMotion: text("sales_motion").notNull().default("outbound"), // inbound | outbound | partner | referral | expansion
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  closeDate: text("close_date"),       // YYYY-MM-DD — anticipated contract close
  mrr: real("mrr"),                    // monthly recurring revenue in USD
  revenueDate: text("revenue_date"),   // YYYY-MM-DD — expected billing start
  studioName: text("studio_name"),     // company / account name
  notes: text("notes"),                // current freeform notes
  position: integer("position").default(0),
  twentyId: text("twenty_id"),         // original Twenty opportunity ID for migration
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("deals_tenant_stage").on(table.tenantId, table.stage),
]);

// ─── Deal Activities (timestamped log) ───────────────────────────────────────
export const dealActivities = sqliteTable("deal_activities", {
  id: text("id").primaryKey(),
  dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  type: text("type").notNull().default("note"), // note | stage_change | email | call | meeting
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("deal_activities_deal").on(table.dealId),
]);
