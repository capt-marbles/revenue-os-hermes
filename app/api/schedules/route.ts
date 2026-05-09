import { NextRequest } from "next/server";
import { db } from "@/db";
import { schedules, agents, sequences } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";


export async function GET() {
  const tenantId = getTenantId();

  const result = db
    .select()
    .from(schedules)
    .where(eq(schedules.tenantId, tenantId))
    .orderBy(desc(schedules.updatedAt))
    .all();

  // Batch-load target names to avoid N+1 queries
  const agentIds = result.filter((s) => s.type === "agent").map((s) => s.targetId);
  const sequenceIds = result.filter((s) => s.type === "sequence").map((s) => s.targetId);

  const agentNames = new Map<string, string>();
  const sequenceNames = new Map<string, string>();

  if (agentIds.length > 0) {
    const agentRows = db.select({ id: agents.id, name: agents.name }).from(agents).all();
    for (const a of agentRows) agentNames.set(a.id, a.name);
  }

  if (sequenceIds.length > 0) {
    const sequenceRows = db.select({ id: sequences.id, name: sequences.name }).from(sequences).all();
    for (const p of sequenceRows) sequenceNames.set(p.id, p.name);
  }

  const enriched = result.map((s) => {
    let targetName = "Unknown";
    if (s.type === "agent") {
      targetName = agentNames.get(s.targetId) ?? "Unknown agent";
    } else if (s.type === "sequence") {
      targetName = sequenceNames.get(s.targetId) ?? "Unknown sequence";
    }
    return { ...s, targetName };
  });

  return Response.json(enriched);
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["agent", "sequence"]),
  targetId: z.string().min(1),
  input: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().default("UTC"),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const schedule = {
    id: ulid(),
    tenantId,
    ...data,
    enabled: 1,
  };

  db.insert(schedules).values(schedule).run();

  return Response.json(schedule, { status: 201 });
}
