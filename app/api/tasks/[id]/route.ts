import { NextRequest } from "next/server";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { hermesBridge } from "@/lib/hermes/hermes-task-provider";

import { taskUpdateSchema } from "@/lib/schemas";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const task = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
    .get();

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  return Response.json(task);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();

  // If tags is an array, stringify it before schema validation
  if (body.tags && Array.isArray(body.tags)) {
    body.tags = JSON.stringify(body.tags);
  }

  const parsed = taskUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  db.update(tasks)
    .set({
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tasks.id, id))
    .run();

  // Log status changes to audit for CoS awareness
  if (parsed.data.status && parsed.data.status !== existing.status) {
    logAudit({
      action: "task.status_changed",
      entity: "task",
      entityId: id,
      summary: `Task "${existing.title}" moved from ${existing.status} to ${parsed.data.status}`,
      source: "operator",
      metadata: { from: existing.status, to: parsed.data.status, title: existing.title },
    });

    // Sync status to Hermes if this task has a linked Hermes task
    // The Hermes task ID is stored in the dedicated hermesTaskId column
    const hermesTaskId = existing.hermesTaskId;
    if (hermesTaskId && parsed.data.status === "done") {
      await hermesBridge.completeHermesTask(hermesTaskId, {
        summary: `Revenue OS task moved to done: ${existing.title}`,
        revenueOsTaskId: id,
      }).catch((err) => {
        console.error(`[TaskSync] Failed to complete Hermes task ${hermesTaskId}:`, err);
      });
    } else if (hermesTaskId && parsed.data.status === "blocked") {
      await hermesBridge.blockHermesTask(hermesTaskId, "Blocked in Revenue OS").catch((err) => {
        console.error(`[TaskSync] Failed to block Hermes task ${hermesTaskId}:`, err);
      });
    }
  }

  return Response.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const existing = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
    .get();

  db.delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
    .run();

  if (existing) {
    logAudit({
      action: "task.deleted",
      entity: "task",
      entityId: id,
      summary: `Task "${existing.title}" deleted`,
      source: "operator",
    });
  }

  return Response.json({ success: true });
}
