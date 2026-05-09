import { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLog, desks } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = request.nextUrl;
  const deskSlug = searchParams.get("deskId");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  let results = db
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .all();

  if (deskSlug) {
    const desk = db.select().from(desks).where(
      and(eq(desks.tenantId, tenantId), eq(desks.slug, deskSlug))
    ).get();
    if (desk && !desk.global) {
      results = results.filter((r) => r.deskId === desk.id || r.deskId === null);
    }
  }

  return Response.json(results);
}

const createSchema = z.object({
  action: z.string(),
  entity: z.string(),
  entityId: z.string().optional(),
  summary: z.string(),
  source: z.string().default("operator"),
  deskId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  logAudit(parsed.data);
  return Response.json({ success: true }, { status: 201 });
}
