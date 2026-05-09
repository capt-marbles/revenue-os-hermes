/**
 * hermes-agent-executor.ts
 *
 * Spawns Revenue OS agents as Hermes workers.
 *
 * Architecture:
 * The Hermes dispatcher owns the kanban task lifecycle (claim → work → complete).
 * When it picks up a task assigned to a Revenue OS profile (scout, drafter, etc.),
 * the worker needs to know to run a Revenue OS agent, not just act as a bare LLM.
 *
 * Solution: the task body tells the Hermes worker to POST to the Revenue OS
 * agent-run endpoint (/api/runs). The task body becomes the agent's input.
 * The Hermes worker acts as a thin relay/proxy — it owns the task lifecycle,
 * but delegates the actual work to Revenue OS's executeAgent.
 *
 * For cases where Hermes IS the execution engine (no Revenue OS dependency),
 * a Revenue OS agent's system prompt + tools are embedded in the task body
 * and the Hermes worker runs them directly.
 */

import { spawn } from "child_process";
import { ulid } from "ulid";
import { db } from "@/db";
import { agents, agentRuns } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { hermesBridge } from "./hermes-task-provider";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SpawnWorkerParams {
  hermesTaskId: string;
  revenueOsAgentId: string;
  taskTitle: string;
  taskBody: string;
  tenantId?: string;
  maxRuntimeSeconds?: number;
}

// ─── Agent → Hermes Profile resolution ───────────────────────────────────────

const AGENT_SLUG_TO_HERMES_PROFILE: Record<string, string> = {
  scout:              "scout",
  drafter:            "drafter",
  steward:            "steward",
  marketing:          "marketing",
  "sales-engineering": "sales-engineering",
  "chief-of-staff":   "chief-of-staff",
  leo:                "leo",
  outreach:           "outreach",
};

function getHermesProfileForAgent(agentSlug: string): string | null {
  return AGENT_SLUG_TO_HERMES_PROFILE[agentSlug] ?? null;
}

function getRevenueOsAgentRunUrl(): string {
  // In production, this would be the external URL of Revenue OS
  // For local dev, use the internal API URL
  return process.env["REVENUE_OS_AGENT_RUN_URL"] ?? "http://localhost:3000/api/runs";
}

// ─── Build the task body for a Revenue OS agent dispatch ─────────────────────

function buildRevenueOsAgentTaskBody(params: {
  agentId: string;
  agentName: string;
  agentSystemPrompt: string | null;
  taskTitle: string;
  taskBody: string;
  runId: string;
}): string {
  const { agentId, agentName, agentSystemPrompt, taskTitle, taskBody, runId } = params;

  return [
    `# Revenue OS Agent Task`,
    ``,
    `**Task**: ${taskTitle}`,
    `**Run ID**: ${runId}`,
    `**Agent**: ${agentName} (${agentId})`,
    ``,
    agentSystemPrompt ? `## Agent System Prompt\n${agentSystemPrompt}` : "",
    ``,
    `## Task Instructions\n${taskBody}`,
    ``,
    `## Execution Protocol`,
    ``,
    `1. Create an agent run record in Revenue OS by POSTing to \`/api/runs\``,
    `   with body: \`{"agentId":"${agentId}","taskTitle":"${taskTitle}","status":"queued"}\``,
    ``,
    `2. Execute the agent work based on the instructions above`,
    ``,
    `3. On completion, POST to \`/api/runs/${runId}\` with the result`,
    ``,
    `4. Mark the Hermes task done with \`hermes kanban complete ${runId} --summary "..."\``,
  ].filter(Boolean).join("\n");
}

// ─── Spawn a Hermes worker for a Revenue OS agent ────────────────────────────

/**
 * Spawn a Hermes agent as a worker for a Revenue OS agent task.
 *
 * The worker will:
 * 1. Claim the Hermes task (auto-done by dispatcher, but we can pre-claim)
 * 2. POST to Revenue OS's agent run endpoint to start the actual agent work
 * 3. Track the run to completion via SSE or polling
 * 4. Mark the Hermes task done
 *
 * Returns the spawn proc and the runId.
 */
export async function spawnRevenueOsAgentWorker(
  params: SpawnWorkerParams
): Promise<{ proc: ReturnType<typeof spawn>; runId: string }> {
  const tenantId = params.tenantId ?? getTenantId();

  // Look up the Revenue OS agent
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, params.revenueOsAgentId), eq(agents.tenantId, tenantId)))
    .get();

  if (!agent) {
    throw new Error(`Agent ${params.revenueOsAgentId} not found for tenant ${tenantId}`);
  }

  const profile = getHermesProfileForAgent(agent.slug);
  if (!profile) {
    throw new Error(`Agent slug ${agent.slug} has no Hermes profile mapping`);
  }

  // Create a Revenue OS agent run record first (before spawning the worker)
  const runId = ulid();
  const now = new Date().toISOString();

  db.insert(agentRuns)
    .values({
      id: runId,
      tenantId,
      agentId: agent.id,
      taskId: null,
      status: "queued",
      trigger: "kanban-dispatched",
      input: JSON.stringify({
        title: params.taskTitle,
        body: params.taskBody,
        hermesTaskId: params.hermesTaskId,
      }),
      createdAt: now,
    })
    .run();

  // Build the task body that gets injected into the Hermes worker
  const workerTaskBody = buildRevenueOsAgentTaskBody({
    agentId: agent.id,
    agentName: agent.name,
    agentSystemPrompt: agent.systemPrompt,
    taskTitle: params.taskTitle,
    taskBody: params.taskBody,
    runId,
  });

  // Spawn the Hermes worker process
  // The worker will use the Revenue OS SOUL.md as its system prompt and
  // the task body as the execution instructions
  const proc = spawn("hermes", [
    "-p", profile,
    "--skills", "kanban-worker",
    "--no-agent",
    "chat",
    workerTaskBody,
  ], {
    env: {
      ...process.env,
      NO_COLOR: "1",
      HERMES_KANBAN_WORKSPACE: "scratch",
      REVENUE_OS_RUN_ID: runId,
      REVENUE_OS_AGENT_ID: agent.id,
      REVENUE_OS_TENANT_ID: tenantId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Log stdout/stderr in the background
  proc.stdout?.on("data", (d) => {
    console.log(`[hermes-worker:${profile}:${runId}] ${d.toString().trim()}`);
  });
  proc.stderr?.on("data", (d) => {
    console.error(`[hermes-worker:${profile}:${runId}] ${d.toString().trim()}`);
  });

  proc.on("error", (err) => {
    console.error(`[hermes-worker:${profile}:${runId}] spawn error:`, err);
    // Update the agent run as failed
    db.update(agentRuns)
      .set({
        status: "failed",
        error: err.message,
        completedAt: new Date().toISOString(),
      })
      .where(eq(agentRuns.id, runId))
      .run();
  });

  proc.on("close", (code) => {
    console.log(`[hermes-worker:${profile}:${runId}] exited with code ${code}`);
    if (code === 0) {
      db.update(agentRuns)
        .set({
          status: "success",
          completedAt: new Date().toISOString(),
        })
        .where(eq(agentRuns.id, runId))
        .run();
    } else {
      db.update(agentRuns)
        .set({
          status: "failed",
          error: `Worker exited with code ${code}`,
          completedAt: new Date().toISOString(),
        })
        .where(eq(agentRuns.id, runId))
        .run();
    }
  });

  return { proc, runId };
}

// ─── Create a Hermes kanban task and spawn a Revenue OS agent worker ─────────

/**
 * Convenience: create a Hermes task for a Revenue OS agent and immediately
 * dispatch a worker for it. Used by the scheduler when a schedule fires.
 *
 * Returns the Hermes task ID and the Revenue OS agent run ID.
 */
export async function dispatchRevenueOsAgentToHermes(params: {
  agentId: string;
  taskTitle: string;
  taskBody: string;
  parentHermesTaskIds?: string[];
  tenantId?: string;
  maxRuntimeSeconds?: number;
}): Promise<{ hermesTaskId: string; runId: string }> {
  const tenantId = params.tenantId ?? getTenantId();

  // Create the Hermes kanban task
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, params.agentId), eq(agents.tenantId, tenantId)))
    .get();

  if (!agent) {
    throw new Error(`Agent ${params.agentId} not found`);
  }

  const profile = getHermesProfileForAgent(agent.slug);
  if (!profile) {
    throw new Error(`No Hermes profile for agent slug: ${agent.slug}`);
  }

  // Create Hermes task
  const hermesTask = await hermesBridge.dispatchAgent({
    agentId: profile, // use Hermes profile name as assignee
    taskTitle: params.taskTitle,
    taskBody: params.taskBody,
    parentHermesTaskIds: params.parentHermesTaskIds,
    tenantId,
    maxRuntimeSeconds: params.maxRuntimeSeconds ?? 300,
  });

  // Create Revenue OS agent run record
  const runId = ulid();
  const now = new Date().toISOString();

  db.insert(agentRuns)
    .values({
      id: runId,
      tenantId,
      agentId: agent.id,
      taskId: null,
      status: "queued",
      trigger: "kanban-dispatched",
      input: JSON.stringify({
        title: params.taskTitle,
        body: params.taskBody,
        hermesTaskId: hermesTask,
      }),
      createdAt: now,
    })
    .run();

  // Spawn the worker to claim and execute the task
  // Note: the Hermes dispatcher handles the actual spawn. This function
  // just creates the task + run record. For immediate spawning, call
  // spawnRevenueOsAgentWorker separately.
  return { hermesTaskId: hermesTask, runId };
}

// ─── Get Revenue OS agent runs linked to a Hermes task ────────────────────────

export function getRunsForHermesTask(hermesTaskId: string) {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.tenantId, getTenantId()))
    .all()
    .filter((r) => {
      try {
        const input = r.input ? JSON.parse(r.input) : null;
        return input?.hermesTaskId === hermesTaskId;
      } catch {
        return false;
      }
    });
}