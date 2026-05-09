import { NextRequest } from "next/server";
import { db } from "@/db";
import { agents, agentRuns, sharedMemory, tasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { streamAgent } from "@/lib/agents/stream-executor";
import { z } from "zod";

const runSchema = z.object({
  taskId: z.string().optional(),
  input: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { taskId, input } = parsed.data;

  let task = null;
  if (taskId) {
    task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
      .get();
  }

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

  const memory = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send runId immediately so the client can track it
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "run_started", runId })}\n\n`,
        ),
      );

      streamAgent(
        {
          runId,
          tenantId,
          agent,
          task: task
            ? { title: task.title, description: task.description }
            : null,
          taskId: taskId || null,
          input,
          memory,
        },
        {
          onData: (text) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", text })}\n\n`,
              ),
            );
          },
          onStatus: (status, metadata) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "status", status, ...metadata })}\n\n`,
              ),
            );
          },
          onDone: (result) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "done", ...result })}\n\n`,
              ),
            );
            controller.close();
          },
        },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
