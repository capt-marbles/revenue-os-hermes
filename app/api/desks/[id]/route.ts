import { NextRequest } from "next/server";
import { db } from "@/db";
import { desks, deskAgents, agents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  // Find by ID or slug
  const desk = db
    .select()
    .from(desks)
    .where(and(eq(desks.tenantId, tenantId), eq(desks.slug, id)))
    .get()
    || db
      .select()
      .from(desks)
      .where(and(eq(desks.id, id), eq(desks.tenantId, tenantId)))
      .get();

  if (!desk) {
    return Response.json({ error: "Desk not found" }, { status: 404 });
  }

  // Get assigned agents
  const assignedAgents = db
    .select({ agent: agents })
    .from(deskAgents)
    .innerJoin(agents, eq(deskAgents.agentId, agents.id))
    .where(eq(deskAgents.deskId, desk.id))
    .all();

  return Response.json({
    ...desk,
    agents: assignedAgents.map((a) => a.agent),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();

  const desk = db
    .select()
    .from(desks)
    .where(and(eq(desks.id, id), eq(desks.tenantId, tenantId)))
    .get();

  if (!desk) {
    return Response.json({ error: "Desk not found" }, { status: 404 });
  }

  db.update(desks)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(desks.id, id))
    .run();

  return Response.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  // Remove agent assignments first
  db.delete(deskAgents).where(eq(deskAgents.deskId, id)).run();

  db.delete(desks)
    .where(and(eq(desks.id, id), eq(desks.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
