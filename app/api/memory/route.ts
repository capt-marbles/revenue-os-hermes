import { NextRequest } from "next/server";
import { db } from "@/db";
import { sharedMemory } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";
import { checkMemoryProtection } from "@/lib/memory-protection";


export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = request.nextUrl;
  const category = searchParams.get("category");
  const layer = searchParams.get("layer");
  const scopeRefId = searchParams.get("scopeRefId");

  let results = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  if (category) {
    results = results.filter((m) => m.category === category);
  }
  if (layer) {
    results = results.filter((m) => m.layer === layer);
  }
  if (scopeRefId !== null) {
    results = results.filter((m) => m.scopeRefId === scopeRefId);
  }

  return Response.json(results);
}

const upsertSchema = z.object({
  layer: z.enum(["global", "goal", "agent", "task", "run"]).default("global"),
  scopeRefId: z.string().default(""),
  category: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1),
  updatedBy: z.string().default("human"),
  confidence: z.number().min(0).max(1).default(1),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Protect brand_voice from non-human writes
  const blocked = checkMemoryProtection(data.category, data.updatedBy);
  if (blocked) {
    return Response.json({ error: blocked }, { status: 403 });
  }

  // Check for existing entry with same tenant + category + key
  const existing = db
    .select()
    .from(sharedMemory)
    .where(
      and(
        eq(sharedMemory.tenantId, tenantId),
        eq(sharedMemory.layer, data.layer),
        eq(sharedMemory.scopeRefId, data.scopeRefId),
        eq(sharedMemory.category, data.category),
        eq(sharedMemory.key, data.key)
      )
    )
    .get();

  if (existing) {
    db.update(sharedMemory)
      .set({
        value: data.value,
        updatedBy: data.updatedBy,
        confidence: data.confidence,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sharedMemory.id, existing.id))
      .run();
    return Response.json({ ...existing, value: data.value });
  }

  const entry = {
    id: ulid(),
    tenantId,
    ...data,
  };

  db.insert(sharedMemory).values(entry).run();
  return Response.json(entry, { status: 201 });
}
