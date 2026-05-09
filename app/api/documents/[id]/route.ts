import { NextRequest } from "next/server";
import { db } from "@/db";
import { documents, agents, agentRuns, tasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const doc = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
    .get();

  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  // Enrich with related data
  const agent = doc.agentId
    ? db.select({ name: agents.name }).from(agents).where(eq(agents.id, doc.agentId)).get()
    : null;
  const run = doc.agentRunId
    ? db.select().from(agentRuns).where(eq(agentRuns.id, doc.agentRunId)).get()
    : null;
  const task = doc.taskId
    ? db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, doc.taskId)).get()
    : null;

  return Response.json({
    ...doc,
    agentName: agent?.name ?? null,
    taskTitle: task?.title ?? null,
    run: run ? { status: run.status, durationMs: run.durationMs, costEstimate: run.costEstimate } : null,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  db.delete(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
