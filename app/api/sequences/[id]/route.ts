import { NextRequest } from "next/server";
import { db } from "@/db";
import { sequences, sequenceSteps, sequenceRuns, agents } from "@/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const sequence = db
    .select()
    .from(sequences)
    .where(and(eq(sequences.id, id), eq(sequences.tenantId, tenantId)))
    .get();

  if (!sequence) {
    return Response.json({ error: "Sequence not found" }, { status: 404 });
  }

  // Get steps with agent names
  const steps = db
    .select({
      step: sequenceSteps,
      agentName: agents.name,
      agentSlug: agents.slug,
    })
    .from(sequenceSteps)
    .leftJoin(agents, eq(sequenceSteps.agentId, agents.id))
    .where(eq(sequenceSteps.sequenceId, id))
    .orderBy(asc(sequenceSteps.position))
    .all();

  // Get recent runs
  const runs = db
    .select()
    .from(sequenceRuns)
    .where(eq(sequenceRuns.sequenceId, id))
    .orderBy(desc(sequenceRuns.createdAt))
    .limit(10)
    .all();

  return Response.json({
    ...sequence,
    steps: steps.map((s) => ({
      ...s.step,
      agentName: s.agentName,
      agentSlug: s.agentSlug,
    })),
    runs,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  // Delete steps first
  db.delete(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, id))
    .run();

  db.delete(sequences)
    .where(and(eq(sequences.id, id), eq(sequences.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
