import { NextRequest } from "next/server";
import { db } from "@/db";
import { deals, dealActivities } from "@/db/schema";
import { eq, and, asc, or } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";
import { syncLocalDealToTwenty } from "@/lib/crm/deal-sync";
import { LOCAL_DEAL_STAGES } from "@/lib/crm/deal-stages";

const STAGES = LOCAL_DEAL_STAGES;

const SALES_MOTIONS = ["inbound", "outbound", "partner", "referral", "expansion"] as const;

const createSchema = z.object({
  name: z.string().min(1),
  stage: z.enum(STAGES).default("target_account"),
  salesMotion: z.enum(SALES_MOTIONS).default("outbound"),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  closeDate: z.string().optional(),
  mrr: z.number().nonnegative().optional(),
  revenueDate: z.string().optional(),
  studioName: z.string().optional(),
  notes: z.string().optional(),
  twentyId: z.string().optional(),
});

export async function GET() {
  const tenantId = getTenantId();
  const rows = db
    .select()
    .from(deals)
    .where(eq(deals.tenantId, tenantId))
    .orderBy(asc(deals.stage), asc(deals.position), asc(deals.createdAt))
    .all();

  // Group by stage
  const grouped: Record<string, typeof rows> = {};
  for (const deal of rows) {
    if (!grouped[deal.stage]) grouped[deal.stage] = [];
    grouped[deal.stage].push(deal);
  }

  return Response.json({ deals: rows, grouped });
}

export async function POST(req: NextRequest) {
  const tenantId = getTenantId();
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Dedup: match on name, or studioName when provided
  const { name, studioName } = parsed.data;
  const dupChecks = [eq(deals.name, name)];
  if (studioName?.trim()) dupChecks.push(eq(deals.studioName, studioName.trim()));
  const existing = db
    .select()
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), or(...dupChecks)))
    .get();
  if (existing) {
    return Response.json({ deal: existing, duplicate: true }, { status: 200 });
  }

  const now = new Date().toISOString();
  const deal = {
    id: ulid(),
    tenantId,
    ...parsed.data,
    contactEmail: parsed.data.contactEmail || null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(deals).values(deal).run();

  // Log creation activity
  db.insert(dealActivities).values({
    id: ulid(),
    dealId: deal.id,
    content: `Deal created in stage: ${deal.stage}`,
    type: "note",
    createdAt: now,
  }).run();

  try {
    const sync = await syncLocalDealToTwenty({ tenantId, dealId: deal.id });
    return Response.json({ deal, sync }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    console.error("Failed to sync created deal to Twenty:", message);
    return Response.json(
      {
        deal,
        sync: {
          ok: false,
          error: message,
        },
      },
      { status: 201 },
    );
  }
}
