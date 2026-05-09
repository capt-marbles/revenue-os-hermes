/**
 * hermes-task-provider.ts
 *
 * Bridges Revenue OS's task system with Hermes Kanban.
 *
 * Design:
 * - Revenue OS task table stays as the primary store for human-facing UI
 * - Hermes Kanban handles the worker execution layer for tasks that need
 *   multi-agent fan-out, dependency tracking, and orchestrated dispatch
 * - When a task is "dispatched to Hermes", we create a parallel Hermes task
 *   and store the Hermes task ID on the Revenue OS task record
 * - Status syncs back: when a Hermes worker completes, the corresponding
 *   Revenue OS task is updated via webhooks or polling
 *
 * Two modes:
 * 1. DUAL-WRITE (default): task created in Revenue OS, Hermes task created as mirror
 * 2. BRIDGE-ONLY: Revenue OS task exists, Hermes task is the execution layer
 *
 * Workers: Maps Revenue OS agent slugs (scout, drafter, steward, etc.)
 *          to Hermes profile names, falling back to the agent's system prompt
 *          and tools as inline instructions.
 */

import { ulid } from "ulid";
import {
  kanbanCreate,
  kanbanShow,
  kanbanList,
  kanbanComplete,
  kanbanBlock,
  kanbanUnblock,
  kanbanComment,
  kanbanReclaim,
  kanbanReassign,
  kanbanArchive,
  kanbanStats,
  kanbanAssignees,
  kanbanDispatch,
  kanbanRuns,
  kanbanHeartbeat,
  type CreateTaskOptions,
  type HermesTask,
  type HermesTaskRun,
  type KanbanStats,
} from "./hermes-kanban-service";
import { db } from "@/db";
import { tasks, agents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

// ─── Revenue OS → Hermes profile mapping ──────────────────────────────────────

const AGENT_TO_HERMES_PROFILE: Record<string, string> = {
  scout: "scout",
  drafter: "drafter",
  steward: "steward",
  marketing: "marketing",
  "sales-engineering": "sales-engineering",
  "chief-of-staff": "chief-of-staff",
  leo: "leo",
  outreach: "outreach",
};

function resolveHermesAssignee(agentId: string | null | undefined): string | undefined {
  if (!agentId) return undefined;
  // Try slug mapping first
  const bySlug = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (bySlug?.slug && AGENT_TO_HERMES_PROFILE[bySlug.slug]) {
    return AGENT_TO_HERMES_PROFILE[bySlug.slug];
  }
  // Fall back to raw agentId (might be a Hermes profile name)
  return agentId;
}

// ─── HermesTaskHandle ─────────────────────────────────────────────────────────

/**
 * A lightweight handle wrapping a Hermes task with its Revenue OS task ID.
 * Used by callers to interact with the Hermes task without caring about the bridge.
 */
export interface HermesTaskHandle {
  hermesTaskId: string;
  revenueOsTaskId: string;
  assignee: string | null;
  status: string;
}

/**
 * Result of dispatching a Revenue OS task to Hermes.
 */
export interface DispatchResult {
  hermesTaskId: string;
  revenueOsTaskId: string;
  assignee: string;
  workspace: string;
}

// ─── HermesTaskBridge ─────────────────────────────────────────────────────────

export class HermesTaskBridge {
  /**
   * Create a Hermes task that mirrors a Revenue OS task.
   * The Revenue OS task stores the Hermes task ID in its `description` field
   * (or a dedicated column if you've added one — we use description as a
   * fallback that still keeps the link readable).
   *
   * Returns the Hermes task handle.
   */
  async mirrorToHermes(revenueOsTaskId: string): Promise<HermesTaskHandle> {
    const tenantId = getTenantId();

    const task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, revenueOsTaskId), eq(tasks.tenantId, tenantId)))
      .get();

    if (!task) {
      throw new Error(`Revenue OS task ${revenueOsTaskId} not found`);
    }

    // Build the Hermes task body — include original task metadata
    const bodyParts: string[] = [];
    if (task.description) bodyParts.push(task.description);
    bodyParts.push(`[Revenue OS Task ID: ${revenueOsTaskId}]`);
    bodyParts.push(`[Revenue OS Status: ${task.status}]`);
    if (task.deskId) bodyParts.push(`[Revenue OS Desk ID: ${task.deskId}]`);

    const assignee = resolveHermesAssignee(task.assigneeId ?? undefined);

    const hermesTask = await kanbanCreate({
      title: task.title,
      body: bodyParts.join("\n\n"),
      assignee,
      tenant: tenantId,
      priority: this.priorityToNumber(task.priority),
      workspace: "scratch",
      skills: this.inferSkills(task),
      maxRuntimeSeconds: task.timeoutSeconds ?? undefined,
    });

    // Store the Hermes task ID in the dedicated column
    db.update(tasks)
      .set({ hermesTaskId: hermesTask.id, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, revenueOsTaskId))
      .run();

    return {
      hermesTaskId: hermesTask.id,
      revenueOsTaskId,
      assignee: hermesTask.assignee,
      status: hermesTask.status,
    };
  }

  /**
   * Dispatch a Revenue OS schedule/agent to Hermes as a new task.
   * Unlike mirrorToHermes, this is for one-shot agent executions not tied to
   * an existing Revenue OS task.
   *
   * Returns the Hermes task ID.
   */
  async dispatchAgent(params: {
    agentId: string;
    taskTitle: string;
    taskBody: string;
    parentHermesTaskIds?: string[];
    skills?: string[];
    maxRuntimeSeconds?: number;
    tenantId?: string;
  }): Promise<string> {
    const assignee = resolveHermesAssignee(params.agentId);

    const task = await kanbanCreate({
      title: params.taskTitle,
      body: params.taskBody,
      assignee,
      parentIds: params.parentHermesTaskIds,
      tenant: params.tenantId ?? getTenantId(),
      priority: 50,
      workspace: "scratch",
      skills: params.skills,
      maxRuntimeSeconds: params.maxRuntimeSeconds ?? 300,
    });

    return task.id;
  }

  /**
   * Create a fan-out: N parallel Hermes tasks with one parent tracking them.
   * Returns the parent's Hermes task ID.
   */
  async fanOut(
    parentTitle: string,
    childSpecs: Array<{
      title: string;
      body: string;
      assignee: string;
      skills?: string[];
      maxRuntimeSeconds?: number;
    }>,
    parentBody = ""
  ): Promise<{ parentHermesId: string; childHermesIds: string[] }> {
    const childIds: string[] = [];

    // Create all children in parallel
    const childTasks = await Promise.all(
      childSpecs.map((spec) =>
        kanbanCreate({
          title: spec.title,
          body: spec.body,
          assignee: spec.assignee,
          tenant: getTenantId(),
          workspace: "scratch",
          skills: spec.skills,
          maxRuntimeSeconds: spec.maxRuntimeSeconds,
        })
      )
    );

    for (const child of childTasks) {
      childIds.push(child.id);
    }

    // Create parent with all children as parents (parent waits for all children)
    // Actually: parent has no children linked yet — children complete first, then
    // a synthesis task would have parentIds = all child IDs. Here we return the
    // child IDs so the caller can wire up a synthesis parent.
    return {
      parentHermesId: "", // caller creates synthesis parent with these as parents
      childHermesIds: childIds,
    };
  }

  /**
   * Complete a Hermes task and sync status back to Revenue OS.
   */
  async completeHermesTask(
    hermesTaskId: string,
    opts: {
      summary?: string;
      metadata?: Record<string, unknown>;
      revenueOsTaskId?: string;
    }
  ): Promise<void> {
    await kanbanComplete([hermesTaskId], opts);

    // If linked to a Revenue OS task, sync the status
    if (opts.revenueOsTaskId) {
      db.update(tasks)
        .set({
          status: "done",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, opts.revenueOsTaskId))
        .run();
    }
  }

  /**
   * Block a Hermes task (worker needs human input).
   */
  async blockHermesTask(hermesTaskId: string, reason: string): Promise<void> {
    await kanbanBlock([hermesTaskId], reason);
  }

  /**
   * Add a comment/note to a Hermes task.
   */
  async commentHermesTask(
    hermesTaskId: string,
    author: string,
    body: string
  ): Promise<void> {
    await kanbanComment(hermesTaskId, author, body);
  }

  /**
   * Get the current Hermes task status.
   */
  async getHermesTaskStatus(hermesTaskId: string): Promise<HermesTask | null> {
    return kanbanShow(hermesTaskId);
  }

  /**
   * Get task runs (attempt history) from Hermes.
   */
  async getHermesTaskRuns(hermesTaskId: string): Promise<HermesTaskRun[]> {
    return kanbanRuns(hermesTaskId);
  }

  /**
   * Reclaim a stuck Hermes task (abort worker, reset to ready).
   */
  async reclaimHermesTask(hermesTaskId: string): Promise<void> {
    await kanbanReclaim(hermesTaskId);
  }

  /**
   * Reassign a Hermes task to a different profile.
   */
  async reassignHermesTask(hermesTaskId: string, newAssignee: string): Promise<void> {
    await kanbanReassign(hermesTaskId, newAssignee);
  }

  /**
   * Send a heartbeat for a running Hermes task.
   */
  async heartbeatHermesTask(hermesTaskId: string, note: string): Promise<void> {
    await kanbanHeartbeat(hermesTaskId, note);
  }

  /**
   * Get kanban board stats.
   */
  async getBoardStats(): Promise<KanbanStats> {
    return kanbanStats();
  }

  /**
   * Get per-assignee task counts.
   */
  async getAssigneeStats(): Promise<Record<string, { count: number; active: number }>> {
    return kanbanAssignees();
  }

  /**
   * Run a dispatcher pass: reclaim stale, promote ready, spawn workers.
   */
  async runDispatcher(): Promise<{ reclaimed: number; promoted: number; spawned: number }> {
    return kanbanDispatch();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private priorityToNumber(priority: string | null): number {
    switch (priority) {
      case "urgent": return 100;
      case "high":   return 80;
      case "medium": return 50;
      case "low":    return 20;
      default:       return 50;
    }
  }

  private inferSkills(task: { tags?: string | null; deskId?: string | null }): string[] {
    const skills: string[] = [];
    if (!task.tags) return skills;

    let tagArray: string[] = [];
    try {
      tagArray = JSON.parse(task.tags);
    } catch {
      return skills;
    }

    const skillMap: Record<string, string> = {
      "hunter": "hunter",
      "apollo": "apollo",
      "steam": "steam",
      "github": "github",
      "email": "cold-email",
      "research": "research",
      "writing": "copywriting",
    };

    for (const tag of tagArray) {
      if (skillMap[tag.toLowerCase()]) {
        skills.push(skillMap[tag.toLowerCase()]);
      }
    }

    return [...new Set(skills)];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const hermesBridge = new HermesTaskBridge();

// ─── Convenience re-exports ───────────────────────────────────────────────────

export { type HermesTask, type HermesTaskRun, type KanbanStats };