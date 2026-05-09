import { NextRequest } from "next/server";
import { db } from "@/db";
import { directorWiki } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { z } from "zod";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const entry = db
    .select()
    .from(directorWiki)
    .where(and(eq(directorWiki.id, id), eq(directorWiki.tenantId, tenantId)))
    .get();

  if (!entry) {
    return Response.json({ error: "Wiki entry not found" }, { status: 404 });
  }

  return Response.json(entry);
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  category: z.enum(["competitor", "icp_segment", "tactic", "insight", "process", "reference"]).optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(directorWiki)
    .where(and(eq(directorWiki.id, id), eq(directorWiki.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Wiki entry not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.tags !== undefined) updates.tags = JSON.stringify(parsed.data.tags);
  if (parsed.data.confidence !== undefined) updates.confidence = parsed.data.confidence;

  db.update(directorWiki)
    .set(updates)
    .where(eq(directorWiki.id, id))
    .run();

  return Response.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  db.delete(directorWiki)
    .where(and(eq(directorWiki.id, id), eq(directorWiki.tenantId, tenantId)))
    .run();

  return Response.json({ success: true });
}
