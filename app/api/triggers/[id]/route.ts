import { NextRequest } from "next/server";
import { db } from "@/db";
import { triggers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { z } from "zod";

const updateTriggerSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["cron", "email", "webhook", "crm_event", "document_change", "manual", "telegram"]),
  status: z.enum(["active", "paused", "error"]),
  targetType: z.enum(["chief_of_staff", "specialist", "policy"]),
  targetId: z.string().min(1),
  filterConfig: z.string(),
  scheduleConfig: z.string(),
  dedupeKeyStrategy: z.string(),
}).partial();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = updateTriggerSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(triggers)
    .where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Trigger not found" }, { status: 404 });
  }

  db.update(triggers)
    .set({
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(triggers.id, id))
    .run();

  return Response.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  db.delete(triggers)
    .where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
