import { NextRequest } from "next/server";
import { db } from "@/db";
import { desks, deskAgents, agents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { z } from "zod";

// Get agents assigned to this desk
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  // Find desk by ID or slug
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

  const assigned = db
    .select({ agent: agents })
    .from(deskAgents)
    .innerJoin(agents, eq(deskAgents.agentId, agents.id))
    .where(eq(deskAgents.deskId, desk.id))
    .all();

  return Response.json(assigned.map((a) => a.agent));
}

const manageSchema = z.object({
  action: z.enum(["add", "remove"]),
  agentId: z.string().min(1),
});

// Add or remove an agent from this desk
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = manageSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { action, agentId } = parsed.data;

  if (action === "add") {
    const existing = db
      .select()
      .from(deskAgents)
      .where(and(eq(deskAgents.deskId, id), eq(deskAgents.agentId, agentId)))
      .get();

    if (!existing) {
      db.insert(deskAgents).values({ deskId: id, agentId }).run();
    }
  } else {
    db.delete(deskAgents)
      .where(and(eq(deskAgents.deskId, id), eq(deskAgents.agentId, agentId)))
      .run();
  }

  return Response.json({ success: true });
}
