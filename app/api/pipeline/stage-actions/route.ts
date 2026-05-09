import { NextRequest } from "next/server";
import { getTenantId } from "@/lib/tenant";
import { getStageActions, createStageAction } from "@/lib/pipeline/stage-actions";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ulid } from "ulid";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  fromStatus: z.string().default("*"),
  toStatus: z.string().min(1),
  agentId: z.string().min(1),
  promptTemplate: z.string().min(1),
  autoApprove: z.boolean().default(false),
  priority: z.number().int().min(0).default(0),
});

// GET /api/pipeline/stage-actions — list all stage actions
export async function GET() {
  const tenantId = getTenantId();
  const actions = getStageActions(tenantId);

  // Enrich with agent names
  const agentMap = new Map<string, string>();
  db.select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.tenantId, tenantId))
    .all()
    .forEach((a) => agentMap.set(a.id, a.name));

  return Response.json({
    actions: actions.map((a) => ({
      ...a,
      agentName: agentMap.get(a.agentId) || "Unknown",
    })),
  });
}

// POST /api/pipeline/stage-actions — create a new stage action
export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify agent exists
  const agent = db
    .select()
    .from(agents)
    .where(eq(agents.id, parsed.data.agentId))
    .get();

  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 400 });
  }

  const action = createStageAction({
    tenantId,
    ...parsed.data,
  });

  return Response.json({ action, agentName: agent.name }, { status: 201 });
}
