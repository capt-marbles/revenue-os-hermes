import { NextRequest } from "next/server";
import { db } from "@/db";
import { agents, deskAgents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET(
  _request: NextRequest,
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

  return Response.json(agent);
}

export async function DELETE(
  _request: NextRequest,
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

  db.delete(deskAgents).where(eq(deskAgents.agentId, id)).run();
  db.delete(agents).where(eq(agents.id, id)).run();

  return new Response(null, { status: 204 });
}
