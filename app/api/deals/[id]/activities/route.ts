import { NextRequest } from "next/server";
import { db } from "@/db";
import { deals, dealActivities } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

const createSchema = z.object({
  content: z.string().min(1),
  type: z.enum(["note", "email", "call", "meeting", "stage_change"]).default("note"),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = getTenantId();
  const deal = db.select({ id: deals.id }).from(deals)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).get();
  if (!deal) return Response.json({ error: "Not found" }, { status: 404 });

  const activities = db.select().from(dealActivities)
    .where(eq(dealActivities.dealId, id))
    .orderBy(desc(dealActivities.createdAt))
    .all();

  return Response.json({ activities });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = getTenantId();
  const deal = db.select({ id: deals.id }).from(deals)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).get();
  if (!deal) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const activity = {
    id: ulid(),
    dealId: id,
    content: parsed.data.content,
    type: parsed.data.type,
    createdAt: new Date().toISOString(),
  };
  db.insert(dealActivities).values(activity).run();
  return Response.json({ activity }, { status: 201 });
}
