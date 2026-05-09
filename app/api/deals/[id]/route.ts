import { NextRequest } from "next/server";
import { db } from "@/db";
import { deals, dealActivities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";
import { syncLocalDealToTwenty } from "@/lib/crm/deal-sync";
import { LOCAL_DEAL_STAGES } from "@/lib/crm/deal-stages";

const STAGES = LOCAL_DEAL_STAGES;

const SALES_MOTIONS = ["inbound", "outbound", "partner", "referral", "expansion"] as const;

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  stage: z.enum(STAGES).optional(),
  salesMotion: z.enum(SALES_MOTIONS).optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  closeDate: z.string().optional().nullable(),
  mrr: z.number().nonnegative().optional().nullable(),
  revenueDate: z.string().optional().nullable(),
  studioName: z.string().optional(),
  notes: z.string().optional(),
  position: z.number().int().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = getTenantId();
  const deal = db.select().from(deals).where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).get();
  if (!deal) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ deal });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = getTenantId();
  const deal = db.select().from(deals).where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).get();
  if (!deal) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const now = new Date().toISOString();
  const updates = { ...parsed.data, updatedAt: now };

  db.update(deals).set(updates).where(eq(deals.id, id)).run();

  // Log stage change
  if (parsed.data.stage && parsed.data.stage !== deal.stage) {
    db.insert(dealActivities).values({
      id: ulid(),
      dealId: id,
      content: `Stage changed: ${deal.stage} → ${parsed.data.stage}`,
      type: "stage_change",
      createdAt: now,
    }).run();
  }

  const updated = db.select().from(deals).where(eq(deals.id, id)).get();
  try {
    const sync = await syncLocalDealToTwenty({ tenantId, dealId: id });
    return Response.json({ deal: updated, sync });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    console.error("Failed to sync updated deal to Twenty:", message);
    return Response.json({
      deal: updated,
      sync: {
        ok: false,
        error: message,
      },
    });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = getTenantId();
  const deal = db.select().from(deals).where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).get();
  if (!deal) return Response.json({ error: "Not found" }, { status: 404 });
  db.delete(deals).where(eq(deals.id, id)).run();
  return Response.json({ ok: true });
}
