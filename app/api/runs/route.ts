import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentRuns, agents, tasks } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const agentId = searchParams.get("agent_id");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  let results = db
    .select({
      run: agentRuns,
      agentName: agents.name,
      agentSlug: agents.slug,
      taskTitle: tasks.title,
    })
    .from(agentRuns)
    .leftJoin(agents, eq(agentRuns.agentId, agents.id))
    .leftJoin(tasks, eq(agentRuns.taskId, tasks.id))
    .where(eq(agentRuns.tenantId, tenantId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit)
    .all();

  if (status) {
    results = results.filter((r) => r.run.status === status);
  }
  if (agentId) {
    results = results.filter((r) => r.run.agentId === agentId);
  }

  return Response.json(
    results.map((r) => ({
      ...r.run,
      agentName: r.agentName,
      agentSlug: r.agentSlug,
      taskTitle: r.taskTitle,
    }))
  );
}
