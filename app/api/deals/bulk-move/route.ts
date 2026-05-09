import { NextRequest } from "next/server";
import { db } from "@/db";
import { deals, dealActivities } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";
import { syncLocalDealsToTwenty } from "@/lib/crm/deal-sync";
import { LOCAL_DEAL_STAGES } from "@/lib/crm/deal-stages";

const STAGES = LOCAL_DEAL_STAGES;

const schema = z.object({
  ids: z.array(z.string()).min(1),
  stage: z.enum(STAGES),
});

export async function POST(req: NextRequest) {
  const tenantId = getTenantId();
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { ids, stage } = parsed.data;
  const now = new Date().toISOString();

  db.update(deals)
    .set({ stage, updatedAt: now })
    .where(and(eq(deals.tenantId, tenantId), inArray(deals.id, ids)))
    .run();

  const activities = ids.map((dealId) => ({
    id: ulid(),
    dealId,
    content: `Moved to ${stage.replace("_", " ")}`,
    type: "note",
    createdAt: now,
  }));
  db.insert(dealActivities).values(activities).run();

  try {
    const sync = await syncLocalDealsToTwenty({ tenantId, dealIds: ids });
    return Response.json({ moved: ids.length, sync });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    console.error("Failed to sync moved deals to Twenty:", message);
    return Response.json({
      moved: ids.length,
      sync: {
        ok: false,
        error: message,
      },
    });
  }
}
