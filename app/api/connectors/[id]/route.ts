import { NextRequest } from "next/server";
import { db } from "@/db";
import { connectors } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";

import { connectorUpdateSchema } from "@/lib/schemas";

// Toggle a connector on/off
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: definitionId } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = connectorUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { status } = parsed.data;

  // Check if connector record exists
  const existing = db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.name, definitionId)))
    .get();

  if (existing) {
    db.update(connectors)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(connectors.id, existing.id))
      .run();
  } else {
    db.insert(connectors)
      .values({
        id: ulid(),
        tenantId,
        name: definitionId,
        type: "mcp",
        status,
        config: "{}",
      })
      .run();
  }

  return Response.json({ success: true, status });
}
