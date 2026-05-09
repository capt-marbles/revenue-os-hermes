import { NextRequest } from "next/server";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

import { scheduleUpdateSchema } from "@/lib/schemas";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = scheduleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Schedule not found" }, { status: 404 });
  }

  db.update(schedules)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(schedules.id, id))
    .run();

  return Response.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  db.delete(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
