import { NextRequest } from "next/server";
import { db } from "@/db";
import { triggers } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

export async function GET() {
  const tenantId = getTenantId();
  const result = db
    .select()
    .from(triggers)
    .where(eq(triggers.tenantId, tenantId))
    .orderBy(desc(triggers.updatedAt))
    .all();

  return Response.json(result);
}

const createTriggerSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["cron", "email", "webhook", "crm_event", "document_change", "manual", "telegram"]),
  status: z.enum(["active", "paused", "error"]).default("active"),
  targetType: z.enum(["chief_of_staff", "specialist", "policy"]),
  targetId: z.string().min(1),
  filterConfig: z.string().default("{}"),
  scheduleConfig: z.string().default("{}"),
  dedupeKeyStrategy: z.string().default(""),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createTriggerSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const trigger = {
    id: ulid(),
    tenantId,
    ...parsed.data,
  };

  db.insert(triggers).values(trigger).run();

  return Response.json(trigger, { status: 201 });
}
