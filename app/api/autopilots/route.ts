import { NextRequest } from "next/server";
import { db } from "@/db";
import { autopilots } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { computeNextRun } from "@/lib/autopilots/cron";
import { randomUUID } from "crypto";

export async function GET() {
  const tenantId = getTenantId();

  const rows = db
    .select()
    .from(autopilots)
    .where(eq(autopilots.tenantId, tenantId))
    .orderBy(desc(autopilots.createdAt))
    .all();

  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();

  const body = await request.json() as {
    name: string;
    description?: string;
    agentSlug: string;
    prompt: string;
    schedule: string;
    mode?: string;
    harness?: string;
    enabled?: boolean;
  };

  if (!body.name || !body.agentSlug || !body.prompt || !body.schedule) {
    return Response.json({ error: "name, agentSlug, prompt, and schedule are required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const nextRunAt = computeNextRun(body.schedule).toISOString();

  const row = db.insert(autopilots).values({
    id: randomUUID(),
    tenantId,
    name: body.name,
    description: body.description ?? null,
    agentSlug: body.agentSlug,
    prompt: body.prompt,
    schedule: body.schedule,
    mode: body.mode ?? "run_only",
    harness: body.harness ?? "hermes",
    enabled: body.enabled === false ? 0 : 1,
    nextRunAt,
    createdAt: now,
    updatedAt: now,
  }).returning().get();

  return Response.json(row, { status: 201 });
}
