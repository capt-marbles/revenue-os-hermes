import { NextRequest } from "next/server";
import { db } from "@/db";
import { tasks, desks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";
import { logAudit } from "@/lib/audit";


export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const goalId = searchParams.get("goal_id");
  const deskSlug = searchParams.get("deskId");
  const approvalStatus = searchParams.get("approval_status");
  const source = searchParams.get("source");

  const query = db.select().from(tasks).where(eq(tasks.tenantId, tenantId));
  let results = query.all();

  // Filter by desk
  if (deskSlug) {
    const desk = db.select().from(desks).where(
      and(eq(desks.tenantId, tenantId), eq(desks.slug, deskSlug))
    ).get() || db.select().from(desks).where(
      and(eq(desks.id, deskSlug), eq(desks.tenantId, tenantId))
    ).get();
    if (desk) {
      // Global desks see all tasks
      if (!desk.global) {
        results = results.filter((t) => t.deskId === desk.id);
      }
    }
  }

  if (status) {
    results = results.filter((t) => t.status === status);
  }
  if (goalId) {
    results = results.filter((t) => t.goalId === goalId);
  }
  if (approvalStatus) {
    results = results.filter((t) => t.approvalStatus === approvalStatus);
  }
  if (source) {
    results = results.filter((t) => t.source === source);
  }

  // Sort by position within each status group
  results.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Join desk names
  const allDesks = db.select().from(desks).where(eq(desks.tenantId, tenantId)).all();
  const deskMap = new Map(allDesks.map((d) => [d.id, d]));
  const enriched = results.map((t) => {
    const desk = t.deskId ? deskMap.get(t.deskId) : undefined;
    return { ...t, deskName: desk?.name ?? null, deskColor: desk?.color ?? null };
  });

  return Response.json(enriched);
}

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["backlog", "todo", "in_progress", "done", "blocked"]).default("backlog"),
  source: z.enum(["manual", "plan", "trigger", "policy", "webhook"]).default("manual"),
  approvalMode: z.enum(["none", "before_run", "before_send", "before_close"]).default("none"),
  approvalStatus: z.enum(["approved", "pending"]).optional(),
  goalId: z.string().optional(),
  deskId: z.string().optional(),
  assigneeType: z.enum(["human", "agent", "unassigned"]).default("unassigned"),
  assigneeId: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  timeoutSeconds: z.number().int().min(60).max(1800).optional(), // 1-30 minutes
  dueDate: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createTaskSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Resolve deskId from slug if provided
  let resolvedDeskId: string | undefined;
  if (data.deskId) {
    const desk = db.select().from(desks).where(
      and(eq(desks.tenantId, tenantId), eq(desks.slug, data.deskId))
    ).get() || db.select().from(desks).where(
      and(eq(desks.id, data.deskId), eq(desks.tenantId, tenantId))
    ).get();
    resolvedDeskId = desk?.id;
  }

  // Get max position for the target status column
  const existing = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.status, data.status)))
    .all();
  const maxPos = existing.reduce((max, t) => Math.max(max, t.position ?? 0), -1);

  const task = {
    id: ulid(),
    tenantId,
    deskId: resolvedDeskId,
    title: data.title,
    description: data.description,
    status: data.status,
    source: data.source,
    approvalMode: data.approvalMode,
    approvalStatus: data.approvalStatus || (data.approvalMode === "none" ? "approved" : "pending"),
    goalId: data.goalId,
    assigneeType: data.assigneeType,
    assigneeId: data.assigneeId,
    priority: data.priority,
    position: maxPos + 1,
    timeoutSeconds: data.timeoutSeconds,
    dueDate: data.dueDate,
    tags: JSON.stringify(data.tags),
  };

  db.insert(tasks).values(task).run();

  logAudit({
    action: "task.created",
    entity: "task",
    entityId: task.id,
    summary: `Task "${data.title}" created in ${data.status}`,
    source: data.source,
    metadata: { title: data.title, status: data.status, assigneeType: data.assigneeType, priority: data.priority },
  });

  return Response.json(task, { status: 201 });
}
