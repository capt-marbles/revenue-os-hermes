import { db } from "@/db";
import { pipelineStageActions, agents, agentRuns, opportunities } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { executeAgent } from "@/lib/agents/executor";
import { logAudit } from "@/lib/audit";

interface StageTransition {
  tenantId: string;
  opportunityId: string;
  opportunityTitle: string;
  fromStatus: string;
  toStatus: string;
  metadata?: Record<string, unknown>;
}

/**
 * Dispatch pipeline stage actions when an opportunity transitions between statuses.
 * Matches actions where toStatus matches the new status and fromStatus is either
 * '*' (wildcard) or the previous status.
 *
 * Returns the triggered actions and their run IDs.
 */
export function dispatchStageActions(transition: StageTransition): {
  triggered: Array<{ actionId: string; name: string; runId: string }>;
  skipped: Array<{ actionId: string; name: string; reason: string }>;
} {
  const { tenantId, fromStatus, toStatus, opportunityId, opportunityTitle } = transition;

  // Find matching actions: exact toStatus match OR wildcard ('*') toStatus
  const actions = db
    .select()
    .from(pipelineStageActions)
    .where(
      and(
        eq(pipelineStageActions.tenantId, tenantId),
        eq(pipelineStageActions.status, "active"),
      ),
    )
    .all()
    .filter(
      (a) =>
        (a.toStatus === "*" || a.toStatus === toStatus) &&
        (a.fromStatus === "*" || a.fromStatus === fromStatus),
    )
    .sort((a, b) => b.priority - a.priority);

  const triggered: Array<{ actionId: string; name: string; runId: string }> = [];
  const skipped: Array<{ actionId: string; name: string; reason: string }> = [];

  for (const action of actions) {
    // Verify agent exists
    const agent = db
      .select()
      .from(agents)
      .where(and(eq(agents.id, action.agentId), eq(agents.tenantId, tenantId)))
      .get();

    if (!agent) {
      skipped.push({ actionId: action.id, name: action.name, reason: "agent_not_found" });
      continue;
    }

    // Build the prompt from template + opportunity context
    const opportunity = db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .get();

    const input = renderPromptTemplate(action.promptTemplate, {
      opportunityId,
      opportunityTitle,
      accountName: opportunity?.accountName || "",
      contactName: opportunity?.primaryContactName || "",
      fromStatus,
      toStatus,
      score: opportunity?.score?.toString() || "0",
      rationale: opportunity?.rationaleSummary || "",
      ...(transition.metadata || {}),
    });

    const runId = ulid();

    db.insert(agentRuns)
      .values({
        id: runId,
        tenantId,
        agentId: agent.id,
        taskId: null,
        status: "queued",
        trigger: `pipeline_stage:${fromStatus}->${toStatus}`,
        input: JSON.stringify({
          input,
          opportunityId,
          stageActionId: action.id,
          transition: { from: fromStatus, to: toStatus },
        }),
      })
      .run();

    // Fire and forget
    executeAgent({
      runId,
      tenantId,
      agent: {
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        tools: agent.tools,
      },
      task: { title: `Pipeline: ${action.name}`, description: input },
      taskId: null,
      input,
      memory: [],
    }).catch((err) => {
      console.error(`Pipeline stage action failed (${action.name}):`, err);
    });

    triggered.push({ actionId: action.id, name: action.name, runId });

    logAudit({
      action: "pipeline.stage_action.triggered",
      entity: "pipeline_stage_action",
      entityId: action.id,
      summary: `Stage action "${action.name}" triggered: ${fromStatus} → ${toStatus} for "${opportunityTitle}" → agent: ${agent.name}`,
      source: "system",
      metadata: {
        opportunityId,
        fromStatus,
        toStatus,
        agentId: agent.id,
        runId,
      },
    });
  }

  return { triggered, skipped };
}

/**
 * Render a prompt template with opportunity context variables.
 * Supports {{variable}} syntax.
 */
function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || "");
}

/**
 * Get all pipeline stage actions for a tenant.
 */
export function getStageActions(tenantId: string) {
  return db
    .select()
    .from(pipelineStageActions)
    .where(eq(pipelineStageActions.tenantId, tenantId))
    .all();
}

/**
 * Create a new pipeline stage action.
 */
export function createStageAction(params: {
  tenantId: string;
  name: string;
  description?: string;
  fromStatus: string;
  toStatus: string;
  agentId: string;
  promptTemplate: string;
  autoApprove?: boolean;
  priority?: number;
}) {
  const id = ulid();
  const now = new Date().toISOString();

  db.insert(pipelineStageActions)
    .values({
      id,
      tenantId: params.tenantId,
      name: params.name,
      description: params.description || null,
      fromStatus: params.fromStatus || "*",
      toStatus: params.toStatus,
      agentId: params.agentId,
      promptTemplate: params.promptTemplate,
      autoApprove: params.autoApprove ? 1 : 0,
      priority: params.priority || 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { id, ...params };
}

/**
 * Update a pipeline stage action.
 */
export function updateStageAction(
  actionId: string,
  tenantId: string,
  updates: Partial<{
    name: string;
    description: string;
    fromStatus: string;
    toStatus: string;
    agentId: string;
    promptTemplate: string;
    autoApprove: boolean;
    priority: number;
    status: string;
  }>,
) {
  db.update(pipelineStageActions)
    .set({
      ...updates,
      autoApprove: updates.autoApprove !== undefined ? (updates.autoApprove ? 1 : 0) : undefined,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(pipelineStageActions.id, actionId), eq(pipelineStageActions.tenantId, tenantId)))
    .run();
}

/**
 * Delete a pipeline stage action.
 */
export function deleteStageAction(actionId: string, tenantId: string) {
  db.delete(pipelineStageActions)
    .where(and(eq(pipelineStageActions.id, actionId), eq(pipelineStageActions.tenantId, tenantId)))
    .run();
}
