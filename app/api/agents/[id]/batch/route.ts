import { NextRequest } from "next/server";
import { db } from "@/db";
import { agents, agentRuns, sharedMemory } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { executeAgent } from "@/lib/agents/executor";
import { jobQueue } from "@/lib/queue/job-queue";
import { z } from "zod";

const batchSchema = z.object({
  inputs: z.array(z.string().min(1)).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
    .get();

  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { inputs } = parsed.data;

  // Enforce batch size limit (0 = no limit)
  const maxBatch = jobQueue.maxBatchSize;
  if (maxBatch > 0 && inputs.length > maxBatch) {
    return Response.json(
      { error: `Batch size ${inputs.length} exceeds limit of ${maxBatch}. Reduce inputs or increase limit in Settings.` },
      { status: 400 }
    );
  }

  // Load shared memory once for all runs
  const memory = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  // Create all run records and queue execution
  const runIds: string[] = [];

  for (const input of inputs) {
    const runId = ulid();
    runIds.push(runId);

    db.insert(agentRuns)
      .values({
        id: runId,
        tenantId,
        agentId: id,
        status: "queued",
        trigger: "manual",
        input: JSON.stringify({ input, batch: true, batchSize: inputs.length }),
      })
      .run();

    // Fire and forget — queue handles concurrency
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
      task: null,
      taskId: null,
      input,
      memory,
    }).catch((err) => {
      console.error(`Batch run ${runId} failed:`, err);
    });
  }

  return Response.json({
    batchSize: inputs.length,
    runIds,
    queueStats: jobQueue.stats,
  }, { status: 202 });
}
