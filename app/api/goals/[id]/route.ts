import { NextRequest } from "next/server";
import { db } from "@/db";
import { goals, tasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

import { goalUpdateSchema } from "@/lib/schemas";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const goal = db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
    .get();

  if (!goal) {
    return Response.json({ error: "Goal not found" }, { status: 404 });
  }

  // Get linked tasks
  const linkedTasks = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.goalId, id), eq(tasks.tenantId, tenantId)))
    .all();

  return Response.json({ ...goal, tasks: linkedTasks });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = goalUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Goal not found" }, { status: 404 });
  }

  db.update(goals)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(goals.id, id))
    .run();

  return Response.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  // Unlink tasks before deleting to avoid FK constraint violation
  db.update(tasks).set({ goalId: null }).where(eq(tasks.goalId, id)).run();

  db.delete(goals)
    .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
