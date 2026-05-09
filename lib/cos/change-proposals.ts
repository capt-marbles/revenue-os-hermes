/**
 * Change proposal service — the write guard for pipeline modifications.
 *
 * No agent can modify its own config, prompt, or memory directly.
 * All changes go through a proposal → approval → apply → rollback flow.
 *
 * The human is the gatekeeper. Agents propose, humans decide.
 */

import { db } from "@/db";
import { changeProposals, pipelineConfigs, sharedMemory, agents } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { ulid } from "ulid";
import { getTenantId } from "@/lib/tenant";

export interface ChangeProposalCreate {
  tenantId?: string;
  title: string;
  description?: string;
  source: "cos" | "human" | "experiment";
  changeType: "prompt" | "weights" | "threshold" | "memory" | "new_agent" | "source_config";
  targetTable: string; // e.g. "agents", "shared_memory", "pipeline_configs"
  targetId: string;
  afterState: Record<string, unknown>;
  experimentId?: string;
}

/**
 * Create a change proposal. Automatically captures the current state as beforeState.
 */
export function createChangeProposal(params: ChangeProposalCreate): string {
  const tid = params.tenantId ?? getTenantId();
  const id = ulid();
  const now = new Date().toISOString();

  // Auto-capture current state as beforeState for rollback
  const beforeState = captureCurrentState(params.targetTable, params.targetId);

  db.insert(changeProposals)
    .values({
      id,
      tenantId: tid,
      title: params.title,
      description: params.description ?? null,
      source: params.source,
      changeType: params.changeType,
      targetTable: params.targetTable,
      targetId: params.targetId,
      beforeState: JSON.stringify(beforeState),
      afterState: JSON.stringify(params.afterState),
      experimentId: params.experimentId ?? null,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return id;
}

/**
 * Approve a change proposal.
 */
export function approveChangeProposal(proposalId: string, approvedBy: string, tenantId?: string): boolean {
  const tid = tenantId ?? getTenantId();

  const proposal = db
    .select()
    .from(changeProposals)
    .where(and(eq(changeProposals.id, proposalId), eq(changeProposals.tenantId, tid)))
    .get();

  if (!proposal || proposal.status !== "proposed") return false;

  db.update(changeProposals)
    .set({
      status: "approved",
      approvedBy,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(changeProposals.id, proposalId))
    .run();

  return true;
}

/**
 * Reject a change proposal.
 */
export function rejectChangeProposal(proposalId: string, reason: string, tenantId?: string): boolean {
  const tid = tenantId ?? getTenantId();

  const proposal = db
    .select()
    .from(changeProposals)
    .where(and(eq(changeProposals.id, proposalId), eq(changeProposals.tenantId, tid)))
    .get();

  if (!proposal || proposal.status !== "proposed") return false;

  db.update(changeProposals)
    .set({
      status: "rejected",
      rejectionReason: reason,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(changeProposals.id, proposalId))
    .run();

  return true;
}

/**
 * Apply an approved change proposal.
 * This is the only place where config/prompt/memory changes get written.
 */
export function applyChangeProposal(proposalId: string, appliedBy: string, tenantId?: string): boolean {
  const tid = tenantId ?? getTenantId();
  const now = new Date().toISOString();

  const proposal = db
    .select()
    .from(changeProposals)
    .where(and(eq(changeProposals.id, proposalId), eq(changeProposals.tenantId, tid)))
    .get();

  if (!proposal || proposal.status !== "approved") return false;

  try {
    const afterState = JSON.parse(proposal.afterState as string);

    switch (proposal.targetTable) {
      case "pipeline_configs":
        applyPipelineConfigChange(proposal.targetId, afterState);
        break;
      case "agents":
        applyAgentChange(proposal.targetId, afterState);
        break;
      case "shared_memory":
        applyMemoryChange(proposal.targetId, afterState, tid);
        break;
      default:
        console.warn(`[ChangeProposal] Unknown target table: ${proposal.targetTable}`);
        return false;
    }

    db.update(changeProposals)
      .set({
        status: "applied",
        appliedBy,
        appliedAt: now,
        updatedAt: now,
      })
      .where(eq(changeProposals.id, proposalId))
      .run();

    return true;
  } catch (err) {
    console.error(`[ChangeProposal] Apply failed for ${proposalId}:`, err);
    return false;
  }
}

/**
 * Roll back an applied change proposal by restoring the beforeState.
 */
export function rollbackChangeProposal(proposalId: string, tenantId?: string): boolean {
  const tid = tenantId ?? getTenantId();

  const proposal = db
    .select()
    .from(changeProposals)
    .where(and(eq(changeProposals.id, proposalId), eq(changeProposals.tenantId, tid)))
    .get();

  if (!proposal || proposal.status !== "applied") return false;

  try {
    const beforeState = JSON.parse(proposal.beforeState as string);

    switch (proposal.targetTable) {
      case "pipeline_configs":
        applyPipelineConfigChange(proposal.targetId, beforeState);
        break;
      case "agents":
        applyAgentChange(proposal.targetId, beforeState);
        break;
      case "shared_memory":
        applyMemoryChange(proposal.targetId, beforeState, tid);
        break;
    }

    db.update(changeProposals)
      .set({ status: "rolled_back", updatedAt: new Date().toISOString() })
      .where(eq(changeProposals.id, proposalId))
      .run();

    return true;
  } catch (err) {
    console.error(`[ChangeProposal] Rollback failed for ${proposalId}:`, err);
    return false;
  }
}

/**
 * Get pending (proposed) change proposals for human review.
 */
export function getPendingProposals(tenantId?: string, limit = 20) {
  const tid = tenantId ?? getTenantId();
  return db
    .select()
    .from(changeProposals)
    .where(and(eq(changeProposals.tenantId, tid), eq(changeProposals.status, "proposed")))
    .orderBy(desc(changeProposals.createdAt))
    .limit(limit)
    .all();
}

/**
 * Get change proposal history.
 */
export function getProposalHistory(tenantId?: string, limit = 50) {
  const tid = tenantId ?? getTenantId();
  return db
    .select()
    .from(changeProposals)
    .where(eq(changeProposals.tenantId, tid))
    .orderBy(desc(changeProposals.updatedAt))
    .limit(limit)
    .all();
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function captureCurrentState(table: string, targetId: string): Record<string, unknown> {
  switch (table) {
    case "pipeline_configs": {
      const row = db.select().from(pipelineConfigs).where(eq(pipelineConfigs.id, targetId)).get();
      if (!row) return {};
      try { return JSON.parse(row.config as string); } catch { return {}; }
    }
    case "agents": {
      const row = db.select().from(agents).where(eq(agents.id, targetId)).get();
      if (!row) return {};
      return { systemPrompt: row.systemPrompt, model: row.model, tools: row.tools };
    }
    case "shared_memory": {
      // Can't easily capture by composite key from targetId alone
      return {};
    }
    default:
      return {};
  }
}

function applyPipelineConfigChange(configId: string, state: Record<string, unknown>) {
  db.update(pipelineConfigs)
    .set({
      config: JSON.stringify(state),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pipelineConfigs.id, configId))
    .run();
}

function applyAgentChange(agentId: string, state: Record<string, unknown>) {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (state.systemPrompt !== undefined) updates.systemPrompt = state.systemPrompt;
  if (state.model !== undefined) updates.model = state.model;
  if (state.tools !== undefined) updates.tools = typeof state.tools === "string" ? state.tools : JSON.stringify(state.tools);

  db.update(agents)
    .set(updates)
    .where(eq(agents.id, agentId))
    .run();
}

function applyMemoryChange(memoryId: string, state: Record<string, unknown>, tenantId: string) {
  if (state.value !== undefined) {
    db.update(sharedMemory)
      .set({ value: String(state.value), updatedBy: "change_proposal", updatedAt: new Date().toISOString() })
      .where(and(eq(sharedMemory.id, memoryId), eq(sharedMemory.tenantId, tenantId)))
      .run();
  }
}
