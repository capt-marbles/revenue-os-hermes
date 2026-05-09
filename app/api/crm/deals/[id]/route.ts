import { NextRequest } from "next/server";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const body = await request.json().catch(() => ({}));
  const stage = body.stage as string | undefined;
  if (!stage) {
    return Response.json({ error: "stage is required" }, { status: 400 });
  }

  const result = db
    .update(deals)
    .set({ stage, updatedAt: new Date().toISOString() })
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId)))
    .run();

  if (result.changes === 0) {
    return Response.json({ error: "Deal not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
