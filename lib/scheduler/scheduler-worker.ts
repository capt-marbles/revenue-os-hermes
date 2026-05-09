import { db } from "@/db";
import { schedules, agents, agentRuns, sharedMemory } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { executeAgent } from "@/lib/agents/executor";
import { logAudit } from "@/lib/audit";
import { shouldRunNow } from "./cron-utils";
import { dispatchRevenueOsAgentToHermes } from "@/lib/hermes/hermes-agent-executor";

// When HERMES_KANBAN_ENABLED=true, scheduled agents are dispatched via
// Hermes kanban instead of the legacy executeAgent path.
const USE_HERMES_KANBAN = process.env["HERMES_KANBAN_ENABLED"] === "true";

const CHECK_INTERVAL_MS = 60_000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Check all enabled schedules and fire any that are due.
 */
export async function tickScheduler(): Promise<number> {
  const tenantId = getTenantId();

  const dueSchedules = db
    .select()
    .from(schedules)
    .where(and(eq(schedules.tenantId, tenantId), eq(schedules.enabled, 1)))
    .all()
    .filter((s) => shouldRunNow(s.cron, s.lastRunAt));

  for (const schedule of dueSchedules) {
    if (schedule.type === "agent") {
      await fireAgentSchedule(schedule, tenantId);
    }
    // sequence type: fan-out via Hermes kanban
    if (schedule.type === "sequence") {
      await fireSequenceSchedule(schedule, tenantId).catch((err) => {
        console.error(
          JSON.stringify({
            event: "scheduler_sequence_error",
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            error: String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      });
    }
  }

  return dueSchedules.length;
}

async function fireSequenceSchedule(
  schedule: {
    id: string;
    name: string;
    targetId: string;
    input: string;
    runCount: number | null;
  },
  tenantId: string,
): Promise<void> {
  // Lazy-import to avoid circular deps
  const { hermesBridge } = await import("@/lib/hermes/hermes-task-provider");
  const { db } = await import("@/db");
  const { sequences, sequenceSteps, sequenceRuns } = await import("@/db/schema");
  const { eq, and, asc } = await import("drizzle-orm");

  // Look up the sequence
  const sequence = db
    .select()
    .from(sequences)
    .where(and(eq(sequences.id, schedule.targetId), eq(sequences.tenantId, tenantId)))
    .get();

  if (!sequence) {
    console.log(JSON.stringify({
      event: "scheduler_sequence_not_found",
      scheduleId: schedule.id,
      targetId: schedule.targetId,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Get all steps, ordered by position
  const steps = db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequence.id))
    .orderBy(asc(sequenceSteps.position))
    .all();

  if (steps.length === 0) {
    console.log(JSON.stringify({
      event: "scheduler_sequence_empty",
      sequenceId: sequence.id,
      scheduleId: schedule.id,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Create a sequence_run record
  const runId = ulid();
  const now = new Date().toISOString();
  db.insert(sequenceRuns).values({
    id: runId,
    tenantId,
    sequenceId: sequence.id,
    status: "running",
    input: JSON.stringify({ scheduleId: schedule.id, scheduleInput: schedule.input }),
    totalSteps: steps.length,
    startedAt: now,
  }).run();

  // Fan out: all steps run in parallel (group=0 means all same group = parallel)
  // Each step gets the schedule.input as its input and previous_output is templated
  const childSpecs = steps.map((step) => ({
    title: `${sequence.name} / ${step.name}`,
    body: step.promptTemplate
      .replace(/\{\{sequence_input\}\}/g, schedule.input)
      .replace(/\{\{previous_output\}\}/g, ""), // first step has no previous
    assignee: step.agentId, // agentId from sequence_steps maps to Hermes profile
    skills: [] as string[],
    maxRuntimeSeconds: 300,
  }));

  const { childHermesIds } = await hermesBridge.fanOut(
    `${sequence.name} (run ${runId})`,
    childSpecs,
    `Sequence: ${sequence.name} | Schedule: ${schedule.name} | Run: ${runId}`,
  );

  // Store Hermes child IDs in the sequence_run input for tracking
  const updatedInput = JSON.stringify({
    scheduleId: schedule.id,
    scheduleInput: schedule.input,
    hermesChildTaskIds: childHermesIds,
    hermesParentTaskId: "", // filled below
  });
  db.update(sequenceRuns)
    .set({ input: updatedInput })
    .where(eq(sequenceRuns.id, runId))
    .run();

  // Create synthesis parent with all children as parents
  const { kanbanCreate } = await import("@/lib/hermes/hermes-kanban-service");
  const parentTask = await kanbanCreate({
    title: `${sequence.name} — synthesis (run ${runId})`,
    body: `Collects results from ${childHermesIds.length} parallel sequence steps.\nSequence: ${sequence.name}\nRun: ${runId}`,
    assignee: schedule.targetId, // the sequence itself as the synthesis owner
    tenant: tenantId,
    workspace: "scratch",
    parentIds: childHermesIds,
    priority: 50,
    maxRuntimeSeconds: 300,
  });

  // Update sequence_run with parent Hermes task ID
  const finalInput = JSON.stringify({
    scheduleId: schedule.id,
    scheduleInput: schedule.input,
    hermesChildTaskIds: childHermesIds,
    hermesParentTaskId: parentTask.id,
  });
  db.update(sequenceRuns)
    .set({ input: finalInput })
    .where(eq(sequenceRuns.id, runId))
    .run();

  // Update schedule tracking
  db.update(schedules)
    .set({ lastRunAt: now, runCount: (schedule.runCount ?? 0) + 1, updatedAt: now })
    .where(eq(schedules.id, schedule.id))
    .run();

  logAudit({
    action: "trigger_sequence_hermes",
    entity: "schedule",
    entityId: schedule.id,
    summary: `Sequence "${sequence.name}" fired as ${childHermesIds.length} parallel Hermes tasks + synthesis parent ${parentTask.id}`,
    source: "scheduler",
    metadata: { runId, sequenceId: sequence.id, hermesParentTaskId: parentTask.id, childCount: childHermesIds.length },
  });

  console.log(JSON.stringify({
    event: "scheduler_fired_sequence",
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    sequenceId: sequence.id,
    runId,
    hermesParentTaskId: parentTask.id,
    childCount: childHermesIds.length,
    timestamp: now,
  }));
}

async function fireAgentSchedule(
  schedule: {
    id: string;
    name: string;
    targetId: string;
    input: string;
    runCount: number | null;
  },
  tenantId: string,
): Promise<void> {
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, schedule.targetId), eq(agents.tenantId, tenantId)))
    .get();

  if (!agent) {
    console.error(
      JSON.stringify({
        event: "scheduler_agent_not_found",
        scheduleId: schedule.id,
        targetId: schedule.targetId,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  if (agent.status === "running") {
    console.log(
      JSON.stringify({
        event: "scheduler_agent_busy",
        scheduleId: schedule.id,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  const now = new Date().toISOString();

  // Route via Hermes Kanban if enabled, otherwise use legacy executeAgent
  if (USE_HERMES_KANBAN) {
    try {
      const { hermesTaskId, runId } = await dispatchRevenueOsAgentToHermes({
        agentId: agent.id,
        taskTitle: schedule.name,
        taskBody: schedule.input,
        tenantId,
        maxRuntimeSeconds: 300,
      });

      // Mark the schedule fired so it doesn't refire every tick
      db.update(schedules)
        .set({
          lastRunAt: now,
          runCount: (schedule.runCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(schedules.id, schedule.id))
        .run();

      logAudit({
        action: "trigger_agent_hermes",
        entity: "schedule",
        entityId: schedule.id,
        summary: `Schedule "${schedule.name}" dispatched to Hermes task ${hermesTaskId} (run ${runId})`,
        source: "scheduler",
        metadata: { hermesTaskId, runId, agentId: agent.id, scheduleName: schedule.name },
      });

      console.log(
        JSON.stringify({
          event: "scheduler_fired_hermes",
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          agentId: agent.id,
          hermesTaskId,
          runId,
          timestamp: now,
        }),
      );
      return;
    } catch (err) {
      console.error(
        `[Scheduler] Hermes dispatch failed for schedule "${schedule.name}", falling back to legacy:`,
        err,
      );
      // Fall through to legacy path
    }
  }

  // Legacy path: fire directly via executeAgent
  const runId = ulid();

  db.insert(agentRuns)
    .values({
      id: runId,
      tenantId,
      agentId: agent.id,
      taskId: null,
      status: "queued",
      trigger: "scheduled",
      input: JSON.stringify({
        input: schedule.input,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
      }),
    })
    .run();

  // Update schedule tracking
  db.update(schedules)
    .set({
      lastRunAt: now,
      runCount: (schedule.runCount ?? 0) + 1,
      updatedAt: now,
    })
    .where(eq(schedules.id, schedule.id))
    .run();

  const memory = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  logAudit({
    action: "trigger_agent",
    entity: "schedule",
    entityId: schedule.id,
    summary: `Schedule "${schedule.name}" triggered agent "${agent.name}"`,
    source: "scheduler",
    metadata: { runId, agentId: agent.id, scheduleName: schedule.name },
  });

  console.log(
    JSON.stringify({
      event: "scheduler_fired",
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      agentId: agent.id,
      agentName: agent.name,
      runId,
      timestamp: now,
    }),
  );

  // Fire and forget — executor runs via the job queue
  executeAgent({
    runId,
    tenantId,
    agent,
    task: null,
    taskId: null,
    input: schedule.input,
    memory,
  }).catch((err) => {
    console.error(
      `[Scheduler] Agent run ${runId} from schedule "${schedule.name}" failed:`,
      err,
    );
  });
}

/**
 * Start the scheduler background loop.
 * Safe to call multiple times — only one loop runs.
 */
export function startScheduler(): void {
  if (intervalHandle) return;

  console.log(
    JSON.stringify({
      event: "scheduler_started",
      intervalMs: CHECK_INTERVAL_MS,
      timestamp: new Date().toISOString(),
    }),
  );

  // Run immediately on start, then every CHECK_INTERVAL_MS
  tickScheduler().catch((err) => {
    console.error("[Scheduler] Initial tick failed:", err);
  });

  intervalHandle = setInterval(() => {
    tickScheduler().catch((err) => {
      console.error("[Scheduler] Tick failed:", err);
    });
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the scheduler background loop.
 */
export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log(
      JSON.stringify({
        event: "scheduler_stopped",
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
