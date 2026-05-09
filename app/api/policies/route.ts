import { NextRequest } from "next/server";
import { db } from "@/db";
import { policies } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

export async function GET() {
  const tenantId = getTenantId();
  const result = db
    .select()
    .from(policies)
    .where(eq(policies.tenantId, tenantId))
    .orderBy(desc(policies.updatedAt))
    .all();

  return Response.json(result);
}

const createPolicySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["delegation", "spawn", "approval", "trigger", "memory"]),
  scope: z.enum(["global", "goal", "agent", "task_type"]).default("global"),
  targetAgentId: z.string().optional(),
  conditions: z.string().default("{}"),
  actions: z.string().default("{}"),
  enabled: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createPolicySchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const policy = {
    id: ulid(),
    tenantId,
    ...parsed.data,
    enabled: parsed.data.enabled ? 1 : 0,
  };

  db.insert(policies).values(policy).run();

  return Response.json(policy, { status: 201 });
}
