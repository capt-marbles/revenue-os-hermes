import { NextRequest } from "next/server";
import { db } from "@/db";
import { sharedMemory } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

import { memoryUpdateSchema } from "@/lib/schemas";
import { checkMemoryProtection } from "@/lib/memory-protection";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = memoryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(sharedMemory)
    .where(and(eq(sharedMemory.id, id), eq(sharedMemory.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Entry not found" }, { status: 404 });
  }

  // Protect brand_voice from non-human writes
  const updatedBy = parsed.data.updatedBy || "unknown";
  const blocked = checkMemoryProtection(existing.category, updatedBy);
  if (blocked) {
    return Response.json({ error: blocked }, { status: 403 });
  }

  db.update(sharedMemory)
    .set({
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sharedMemory.id, id))
    .run();

  return Response.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  db.delete(sharedMemory)
    .where(and(eq(sharedMemory.id, id), eq(sharedMemory.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
