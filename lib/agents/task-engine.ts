import { db } from "@/db";
import { tasks, goals, agents, agentRuns, sharedMemory } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { ulid } from "ulid";
import { executeAgent } from "./executor";
import { copilotChatSync, getOrCreateTelegramConversation } from "./copilot-chat-sync";
import { logAudit } from "@/lib/audit";

/**
 * Task Execution Engine
 *
 * When a task is approved and assigned to an agent, execute it.
 * On completion, check for the next pending task in the goal tree.
 * On failure, notify the Co-Pilot which may fix, retry, or escalate.
 */

/**
 * Approve a task and trigger execution if it has an assigned agent.
 */
export async function approveTask(taskId: string, tenantId: string): Promise<void> {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return;

  db.update(tasks)
    .set({ approvalStatus: "approved", updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, taskId))
    .run();

  logAudit({
    action: "approve_task",
    entity: "task",
    entityId: taskId,
    summary: `Approved task: "${task.title}"`,
    source: "operator",
    deskId: task.deskId,
  });

  // If assigned to an agent, execute it
  if (task.assigneeType === "agent" && task.assigneeId) {
    await executeTask(task, tenantId);
  }
}

/**
 * Approve all pending tasks under a goal (for "Always Approve" mode).
 */
export async function approveAllForGoal(goalId: string, tenantId: string): Promise<number> {
  const pending = db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.goalId, goalId),
      eq(tasks.approvalStatus, "pending"),
      eq(tasks.tenantId, tenantId),
    ))
    .orderBy(asc(tasks.depth), asc(tasks.position))
    .all();

  // Set the goal to auto-approve mode
  db.update(goals)
    .set({ approvalMode: "auto", updatedAt: new Date().toISOString() })
    .where(eq(goals.id, goalId))
    .run();

  let approved = 0;
  for (const task of pending) {
    db.update(tasks)
      .set({ approvalStatus: "approved", updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, task.id))
      .run();
    approved++;

    if (task.assigneeType === "agent" && task.assigneeId) {
      // Fire and forget — job queue handles concurrency
      executeTask(task, tenantId).catch((err) => {
        console.error(`Auto-execute task ${task.id} failed:`, err);
      });
    }
  }

  logAudit({
    action: "approve_all_tasks",
    entity: "goal",
    entityId: goalId,
    summary: `Approved all ${approved} pending tasks for goal (set to auto mode)`,
    source: "operator",
  });

  return approved;
}

/**
 * Redirect a task — reject the current approach and provide new instructions.
 */
export function redirectTask(taskId: string, newInstructions: string): void {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return;

  db.update(tasks)
    .set({
      approvalStatus: "redirected",
      description: newInstructions,
      status: "todo",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tasks.id, taskId))
    .run();

  logAudit({
    action: "redirect_task",
    entity: "task",
    entityId: taskId,
    summary: `Redirected task: "${task.title}" — new instructions provided`,
    source: "operator",
    deskId: task.deskId,
  });
}

/**
 * Execute a single task via its assigned agent.
 */
async function executeTask(
  task: typeof tasks.$inferSelect,
  tenantId: string
): Promise<void> {
  if (!task.assigneeId) return;

  const agent = db.select().from(agents).where(eq(agents.id, task.assigneeId)).get();
  if (!agent) return;

  // Mark task as in progress
  db.update(tasks)
    .set({ status: "in_progress", updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, task.id))
    .run();

  const memory = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  const runId = ulid();
  db.insert(agentRuns)
    .values({
      id: runId,
      tenantId,
      agentId: agent.id,
      taskId: task.id,
      status: "queued",
      trigger: "goal-decomposition",
      input: JSON.stringify({ input: task.description || task.title, taskTitle: task.title }),
    })
    .run();

  try {
    await executeAgent({
      runId,
      tenantId,
      agent: {
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        tools: agent.tools,
      },
      task: { title: task.title, description: task.description },
      taskId: task.id,
      input: task.description || task.title,
      timeoutSeconds: task.timeoutSeconds,
      memory,
    });

    // Check if it succeeded
    const run = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get();

    if (run?.status === "success") {
      // Task marked done by executor already — check for next tasks
      await processNextTasks(task, tenantId);
    } else {
      // Failed — notify Co-Pilot
      await handleTaskFailure(task, run?.error || "Unknown error", tenantId);
    }
  } catch (err) {
    await handleTaskFailure(
      task,
      err instanceof Error ? err.message : String(err),
      tenantId
    );
  }
}

/**
 * After a task completes, check for the next pending task in the goal tree.
 * If the goal is in "auto" approval mode, auto-approve and execute next tasks.
 */
async function processNextTasks(
  completedTask: typeof tasks.$inferSelect,
  tenantId: string
): Promise<void> {
  if (!completedTask.goalId) return;

  const goal = db.select().from(goals).where(eq(goals.id, completedTask.goalId)).get();
  if (!goal) return;

  // Find next pending tasks at the same level
  const nextTasks = db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.goalId, completedTask.goalId),
      eq(tasks.tenantId, tenantId),
      eq(tasks.approvalStatus, "pending"),
    ))
    .orderBy(asc(tasks.depth), asc(tasks.position))
    .all();

  if (nextTasks.length === 0) {
    // All tasks done — check if goal should be updated
    const allTasks = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.goalId, completedTask.goalId), eq(tasks.tenantId, tenantId)))
      .all();

    const allDone = allTasks.every((t) => t.status === "done");
    if (allDone && allTasks.length > 0) {
      logAudit({
        action: "goal_tasks_complete",
        entity: "goal",
        entityId: goal.id,
        summary: `All ${allTasks.length} tasks completed for goal: "${goal.title}"`,
        source: "system",
      });
    }
    return;
  }

  // If auto-approve mode, execute next tasks
  if (goal.approvalMode === "auto") {
    for (const task of nextTasks) {
      // Only auto-execute depth-appropriate tasks
      // Execute top-level first, then subtasks of completed parents
      if (task.depth === 0 || (task.parentTaskId === completedTask.id)) {
        db.update(tasks)
          .set({ approvalStatus: "approved", updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, task.id))
          .run();

        if (task.assigneeType === "agent" && task.assigneeId) {
          executeTask(task, tenantId).catch((err) => {
            console.error(`Auto-execute next task ${task.id} failed:`, err);
          });
        }
      }
    }
  }
  // If "each" mode, tasks stay pending until the operator approves them
}

/**
 * Handle a failed task — notify the desk Co-Pilot.
 */
async function handleTaskFailure(
  task: typeof tasks.$inferSelect,
  error: string,
  tenantId: string
): Promise<void> {
  db.update(tasks)
    .set({ status: "blocked", updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, task.id))
    .run();

  logAudit({
    action: "task_failed",
    entity: "task",
    entityId: task.id,
    summary: `Task failed: "${task.title}" — ${error.slice(0, 200)}`,
    source: "system",
    deskId: task.deskId,
  });

  // If the task belongs to a desk with a Co-Pilot conversation, notify it
  if (task.deskId) {
    // Find or create a Co-Pilot conversation for failure notifications
    const { copilotConversations } = await import("@/db/schema");
    const existingConv = db
      .select()
      .from(copilotConversations)
      .where(and(
        eq(copilotConversations.tenantId, tenantId),
        eq(copilotConversations.deskId, task.deskId),
      ))
      .get();

    if (existingConv) {
      // Ask the Co-Pilot for a fix
      const failureMessage = `A task has failed and needs your attention:

**Task:** ${task.title}
**Error:** ${error.slice(0, 500)}

What should we do? Options:
1. Retry the task with the same approach
2. Modify the task and retry
3. Skip this task and move to the next one
4. Escalate to the operator

Please recommend an action.`;

      try {
        const response = await copilotChatSync(existingConv.id, failureMessage);
        console.log(JSON.stringify({
          event: "copilot_failure_response",
          taskId: task.id,
          response: response.slice(0, 200),
          timestamp: new Date().toISOString(),
        }));
      } catch {
        // Co-Pilot notification is best-effort
      }
    }
  }
}
