import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET() {
  try {
    const tenantId = getTenantId();
    const rows = db.select().from(deals).where(eq(deals.tenantId, tenantId)).all();

    // Shape matches what the CRM page expects from Twenty
    const opportunities = rows.map((d) => ({
      id: d.id,
      name: d.name,
      stage: d.stage,
      amount: d.mrr != null ? { amountMicros: d.mrr * 1_000_000, currencyCode: "USD" } : null,
      mrr: d.mrr ?? null,
      closeDate: d.closeDate ?? null,
      revenueDate: d.revenueDate ?? null,
      updatedAt: d.updatedAt,
      createdAt: d.createdAt,
      companyId: d.studioName ?? null,
      studioName: d.studioName ?? null,
      contactName: d.contactName ?? null,
      contactEmail: d.contactEmail ?? null,
      salesMotion: d.salesMotion ?? null,
      notes: d.notes ?? null,
    }));

    return Response.json({ data: { opportunities } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to fetch deals" },
      { status: 500 },
    );
  }
}
