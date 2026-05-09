import { NextRequest } from "next/server";
import { db } from "@/db";
import { goals, tasks } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";


export async function GET() {
  const tenantId = getTenantId();

  const result = db
    .select()
    .from(goals)
    .where(eq(goals.tenantId, tenantId))
    .all();

  // Enrich with task counts per goal
  const taskCounts = db
    .select({
      goalId: tasks.goalId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
    })
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .groupBy(tasks.goalId)
    .all();

  const countMap = new Map(
    taskCounts.map((c) => [c.goalId, { total: c.total, done: c.done }])
  );

  const enriched = result.map((g) => ({
    ...g,
    taskCount: countMap.get(g.id)?.total ?? 0,
    tasksDone: countMap.get(g.id)?.done ?? 0,
  }));

  return Response.json(enriched);
}

const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["active", "achieved", "paused", "archived"]).default("active"),
  targetMetric: z.string().optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().default(0),
  unit: z.string().optional(),
  deadline: z.string().optional(),
  priority: z.number().default(0),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createGoalSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const goal = {
    id: ulid(),
    tenantId,
    ...data,
  };

  db.insert(goals).values(goal).run();

  return Response.json(goal, { status: 201 });
}
