/**
 * CoS Delegation — lets the Chief of Staff create tasks for specialist agents.
 *
 * Reusable helper: delegateToAgent(tenantId, agentSlug, task, options)
 */

import { db } from "@/db";
import { agents, tasks, agentRuns } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { logAudit } from "@/lib/audit";

// Known specialist agent slugs → agent IDs
const SPECIALIST_SLUGS: Record<string, string> = {
  scout: "01SCOUT0000000000000000",
  outreach: "01OUTREACH000000000000000",
  steward: "01STEWARD0000000000000000",
};

interface DelegateOptions {
  priority?: "high" | "medium" | "low";
  source?: string;
  goalId?: string;
  deskId?: string;
  approvalMode?: "none" | "before_run" | "before_send" | "before_close";
  autoApprove?: boolean;
  metadata?: Record<string, unknown>;
}

interface DelegateResult {
  success: boolean;
  taskId: string | null;
  runId: string | null;
  error?: string;
}

/**
 * Delegate a task to a specialist agent by slug.
 * Creates a task record, optionally creates an agent run, and audit logs.
 */
export function delegateToAgent(
  tenantId: string,
  agentSlug: string,
  task: string,
  options: DelegateOptions = {},
): DelegateResult {
  // Resolve slug → agent ID
  const agentId = SPECIALIST_SLUGS[agentSlug];
  if (!agentId) {
    return { success: false, taskId: null, runId: null, error: `Unknown agent slug: ${agentSlug}` };
  }

  // Verify agent exists and is not disabled
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
    .get();

  if (!agent) {
    return { success: false, taskId: null, runId: null, error: `Agent not found: ${agentSlug}` };
  }

  if (agent.status === "disabled") {
    return { success: false, taskId: null, runId: null, error: `Agent is disabled: ${agentSlug}` };
  }

  // Create task
  const taskId = ulid();
  const now = new Date().toISOString();

  const taskPriority = options.priority || "medium";

  db.insert(tasks)
    .values({
      id: taskId,
      tenantId,
      deskId: options.deskId || null,
      goalId: options.goalId || null,
      title: `[${agentSlug}] ${task.slice(0, 100)}`,
      description: task,
      status: options.autoApprove ? "in_progress" : "todo",
      source: options.source || "copilot",
      approvalMode: options.approvalMode || "none",
      approvalStatus: options.autoApprove ? "approved" : "pending",
      assigneeType: "agent",
      assigneeId: agentId,
      priority: taskPriority,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Queue agent run if auto-approved
  let runId: string | null = null;

  if (options.autoApprove) {
    runId = ulid();
    db.insert(agentRuns)
      .values({
        id: runId,
        tenantId,
        agentId,
        taskId,
        status: "queued",
        trigger: "copilot_delegation",
        input: JSON.stringify({ input: task }),
        createdAt: now,
      })
      .run();
  }

  // Audit log
  logAudit({
    action: "copilot.delegate",
    entity: "task",
    entityId: taskId,
    summary: `CoS delegated task to ${agent.name} (${agentSlug}): ${task.slice(0, 120)}`,
    source: "copilot",
    metadata: {
      agentSlug,
      agentId,
      taskId,
      runId,
      priority: taskPriority,
      autoApprove: options.autoApprove,
      ...(options.metadata || {}),
    },
  });

  return { success: true, taskId, runId };
}
