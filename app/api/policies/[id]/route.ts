import { NextRequest } from "next/server";
import { db } from "@/db";
import { policies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { z } from "zod";

const updatePolicySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["delegation", "spawn", "approval", "trigger", "memory"]),
  scope: z.enum(["global", "goal", "agent", "task_type"]),
  targetAgentId: z.string().nullable(),
  conditions: z.string(),
  actions: z.string(),
  enabled: z.number().int().min(0).max(1),
}).partial();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = updatePolicySchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(policies)
    .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Policy not found" }, { status: 404 });
  }

  db.update(policies)
    .set({
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(policies.id, id))
    .run();

  return Response.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  db.delete(policies)
    .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
