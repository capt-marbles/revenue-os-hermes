import { NextRequest } from "next/server";
import { db } from "@/db";
import { desks, deskAgents, agents } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

export async function GET() {
  const tenantId = getTenantId();

  const result = db
    .select({
      desk: desks,
      agentCount: sql<number>`(select count(*) from desk_agents where desk_id = ${desks.id})`,
    })
    .from(desks)
    .where(eq(desks.tenantId, tenantId))
    .all();

  return Response.json(
    result.map((r) => ({ ...r.desk, agentCount: r.agentCount }))
  );
}

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  persona: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const desk = {
    id: ulid(),
    tenantId,
    name: data.name,
    slug,
    description: data.description,
    persona: data.persona,
    icon: data.icon,
    color: data.color,
  };

  db.insert(desks).values(desk).run();

  return Response.json(desk, { status: 201 });
}
