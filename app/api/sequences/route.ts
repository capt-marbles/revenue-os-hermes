import { NextRequest } from "next/server";
import { db } from "@/db";
import { sequences, sequenceSteps, sequenceRuns, agents } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";


export async function GET() {
  const tenantId = getTenantId();

  const result = db
    .select({
      sequence: sequences,
      stepCount: sql<number>`(select count(*) from sequence_steps where sequence_id = ${sequences.id})`,
      lastRunStatus: sql<string>`(select status from sequence_runs where sequence_id = ${sequences.id} order by created_at desc limit 1)`,
      runCount: sql<number>`(select count(*) from sequence_runs where sequence_id = ${sequences.id})`,
    })
    .from(sequences)
    .where(eq(sequences.tenantId, tenantId))
    .orderBy(desc(sequences.updatedAt))
    .all();

  return Response.json(
    result.map((r) => ({
      ...r.sequence,
      stepCount: r.stepCount,
      lastRunStatus: r.lastRunStatus,
      runCount: r.runCount,
    }))
  );
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(
    z.object({
      agentId: z.string(),
      name: z.string(),
      promptTemplate: z.string(),
      group: z.number().int().min(0).optional(),
    })
  ).min(1),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, description, steps } = parsed.data;
  const sequenceId = ulid();

  db.insert(sequences)
    .values({
      id: sequenceId,
      tenantId,
      name,
      description,
      status: "active",
    })
    .run();

  for (let i = 0; i < steps.length; i++) {
    db.insert(sequenceSteps)
      .values({
        id: ulid(),
        sequenceId,
        agentId: steps[i].agentId,
        position: i,
        group: steps[i].group ?? i,
        name: steps[i].name,
        promptTemplate: steps[i].promptTemplate,
      })
      .run();
  }

  return Response.json({ id: sequenceId }, { status: 201 });
}
