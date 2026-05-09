import { NextRequest } from "next/server";
import { db } from "@/db";
import { autopilots } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { computeNextRun } from "@/lib/autopilots/cron";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = getTenantId();
  const { id } = await params;

  const row = db.select().from(autopilots)
    .where(and(eq(autopilots.id, id), eq(autopilots.tenantId, tenantId)))
    .get();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = getTenantId();
  const { id } = await params;

  const body = await request.json() as Partial<{
    name: string;
    description: string;
    agentSlug: string;
    prompt: string;
    schedule: string;
    mode: string;
    enabled: boolean;
  }>;

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.agentSlug !== undefined) updates.agentSlug = body.agentSlug;
  if (body.prompt !== undefined) updates.prompt = body.prompt;
  if (body.schedule !== undefined) {
    updates.schedule = body.schedule;
    updates.nextRunAt = computeNextRun(body.schedule).toISOString();
  }
  if (body.mode !== undefined) updates.mode = body.mode;
  if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;

  const row = db.update(autopilots)
    .set(updates)
    .where(and(eq(autopilots.id, id), eq(autopilots.tenantId, tenantId)))
    .returning()
    .get();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = getTenantId();
  const { id } = await params;

  db.delete(autopilots)
    .where(and(eq(autopilots.id, id), eq(autopilots.tenantId, tenantId)))
    .run();

  return new Response(null, { status: 204 });
}
