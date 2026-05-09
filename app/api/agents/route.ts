import { NextRequest } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";


export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source"); // comma-separated, e.g. "custom,seed"

  let query = db.select().from(agents).where(eq(agents.tenantId, tenantId));

  const result = query.all().filter((a) => {
    if (!sourceParam) return true;
    return sourceParam.split(",").includes(a.source);
  });

  return Response.json(result);
}

const createAgentSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  agentType: z.enum(["chief_of_staff", "specialist"]).default("specialist"),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().min(1).default("claude-sonnet-4-20250514"),
  capabilities: z.array(z.string()).default([]),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createAgentSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const agent = {
    id: ulid(),
    tenantId,
    name: data.name,
    slug,
    agentType: data.agentType,
    source: "custom" as const,
    description: data.description || "",
    systemPrompt: data.systemPrompt || "",
    model: data.model,
    capabilities: JSON.stringify(data.capabilities),
  };

  db.insert(agents).values(agent).run();

  return Response.json(agent, { status: 201 });
}
