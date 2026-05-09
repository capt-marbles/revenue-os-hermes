import { NextRequest } from "next/server";
import { db } from "@/db";
import { agents, agentRuns } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { cancelRun } from "@/lib/agents/cancellation";

export async function POST(
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

  // Find the active run for this agent
  const run = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, id), eq(agentRuns.status, "running")))
    .get();

  if (!run) {
    return Response.json({ error: "No running job found" }, { status: 404 });
  }

  const cancelled = cancelRun(run.id);

  // Mark as cancelled regardless — process may have already finished
  const now = new Date().toISOString();
  db.update(agentRuns)
    .set({ status: "cancelled", completedAt: now })
    .where(eq(agentRuns.id, run.id))
    .run();

  db.update(agents)
    .set({ status: "idle" })
    .where(eq(agents.id, id))
    .run();

  return Response.json({ stopped: true, runId: run.id, signalled: cancelled });
}
