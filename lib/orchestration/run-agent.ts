import { db } from "@/db";
import { agentRuns, agents, sharedMemory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { executeAgent } from "@/lib/agents/executor";

interface QueueAgentRunParams {
  tenantId: string;
  agentId: string;
  input: string;
  trigger: string;
  taskId?: string | null;
  metadata?: Record<string, unknown>;
}

export function loadTenantMemory(tenantId: string) {
  return db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();
}

export function queueAgentRun(params: QueueAgentRunParams): { runId: string; accepted: boolean; reason?: string } {
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, params.agentId), eq(agents.tenantId, params.tenantId)))
    .get();

  if (!agent) {
    return { runId: "", accepted: false, reason: "agent_not_found" };
  }

  const runId = ulid();
  db.insert(agentRuns)
    .values({
      id: runId,
      tenantId: params.tenantId,
      agentId: agent.id,
      taskId: params.taskId || null,
      status: "queued",
      trigger: params.trigger,
      input: JSON.stringify({
        input: params.input,
        ...params.metadata,
      }),
    })
    .run();

  const memory = loadTenantMemory(params.tenantId);
  executeAgent({
    runId,
    tenantId: params.tenantId,
    agent: {
      id: agent.id,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      tools: agent.tools,
    },
    task: null,
    taskId: params.taskId || null,
    input: params.input,
    memory,
  }).catch((err) => {
    console.error(`Queued agent run failed (${agent.name}):`, err);
  });

  return { runId, accepted: true };
}
