import { z } from "zod";

/** Allowed fields for PATCH /api/agents/:id */
export const agentUpdateSchema = z.object({
  name: z.string().min(1),
  agentType: z.enum(["chief_of_staff", "specialist"]),
  description: z.string().nullable(),
  model: z.string(),
  tools: z.string(),
  config: z.string(),
  status: z.enum(["idle", "running", "disabled", "error"]),
  systemPrompt: z.string().nullable(),
  capabilities: z.string(),
}).partial();

/** Allowed fields for PATCH /api/tasks/:id */
export const taskUpdateSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  status: z.enum(["backlog", "todo", "in_progress", "done", "blocked"]),
  source: z.enum(["manual", "plan", "trigger", "policy", "webhook"]),
  approvalMode: z.enum(["none", "before_run", "before_send", "before_close"]),
  approvalStatus: z.enum(["approved", "pending"]),
  assigneeType: z.enum(["human", "agent", "unassigned"]),
  assigneeId: z.string().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  position: z.number().int(),
  dueDate: z.string().nullable(),
  goalId: z.string().nullable(),
  deskId: z.string().nullable(),
  tags: z.string(),
}).partial();

/** Allowed fields for PATCH /api/goals/:id */
export const goalUpdateSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  status: z.enum(["active", "achieved", "paused", "archived"]),
  targetMetric: z.string().nullable(),
  targetValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  unit: z.string().nullable(),
  deadline: z.string().nullable(),
  priority: z.number().int(),
}).partial();

/** Allowed fields for PATCH /api/schedules/:id */
export const scheduleUpdateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  input: z.string(),
  cron: z.string(),
  timezone: z.string(),
  enabled: z.number().int().min(0).max(1),
}).partial();

/** Allowed fields for PATCH /api/memory/:id */
export const memoryUpdateSchema = z.object({
  layer: z.enum(["global", "goal", "agent", "task", "run"]),
  scopeRefId: z.string(),
  key: z.string().min(1),
  value: z.string().min(1),
  category: z.string(),
  updatedBy: z.string().nullable(),
  confidence: z.number().min(0).max(1),
}).partial();

/** Allowed fields for PATCH /api/connectors/:id */
export const connectorUpdateSchema = z.object({
  status: z.enum(["connected", "disconnected", "error"]),
  config: z.string(),
}).partial();

/** Allowed fields for PATCH /api/outreach/templates/:id */
export const outreachTemplateUpdateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  channel: z.enum(["email", "linkedin"]),
  tags: z.string(),
  status: z.enum(["active", "archived"]),
}).partial();
