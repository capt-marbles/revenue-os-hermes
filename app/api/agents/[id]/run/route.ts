import { NextRequest } from "next/server";
import { db } from "@/db";
import { agents, agentRuns, sharedMemory, tasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { executeAgent } from "@/lib/agents/executor";
import { z } from "zod";


const runSchema = z.object({
  taskId: z.string().optional(),
  input: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  // Validate agent exists
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
    .get();

  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { taskId, input } = parsed.data;

  // Validate task if provided
  let task = null;
  if (taskId) {
    task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
      .get();
  }

  // Create run record
  const runId = ulid();
  db.insert(agentRuns)
    .values({
      id: runId,
      tenantId,
      agentId: id,
      taskId: taskId || null,
      status: "queued",
      trigger: "manual",
      input: JSON.stringify({ input, taskTitle: task?.title }),
    })
    .run();

  // Get shared memory for prompt context
  const memory = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  // Fire and forget — executor runs in background
  executeAgent({
    runId,
    tenantId,
    agent,
    task: task ? { title: task.title, description: task.description } : null,
    taskId: taskId || null,
    input,
    memory,
  }).catch((err) => {
    console.error(`Agent run ${runId} failed:`, err);
  });

  return Response.json({ runId }, { status: 202 });
}
