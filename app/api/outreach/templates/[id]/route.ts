import { NextRequest } from "next/server";
import { db } from "@/db";
import { outreachTemplates, outreachSends, outreachResponses } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { outreachTemplateUpdateSchema } from "@/lib/schemas";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const template = db
    .select()
    .from(outreachTemplates)
    .where(and(eq(outreachTemplates.id, id), eq(outreachTemplates.tenantId, tenantId)))
    .get();

  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  // Compute effectiveness stats via joins
  const stats = db
    .select({
      totalSends: sql<number>`count(distinct ${outreachSends.id})`,
      replies: sql<number>`sum(case when ${outreachResponses.responseType} = 'reply' then 1 else 0 end)`,
      positiveSentiment: sql<number>`sum(case when ${outreachResponses.sentiment} = 'positive' then 1 else 0 end)`,
      totalResponses: sql<number>`count(${outreachResponses.id})`,
    })
    .from(outreachSends)
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(and(eq(outreachSends.templateId, id), eq(outreachSends.tenantId, tenantId)))
    .get();

  const totalSends = stats?.totalSends ?? 0;
  const replies = stats?.replies ?? 0;
  const positiveSentiment = stats?.positiveSentiment ?? 0;

  return Response.json({
    ...template,
    stats: {
      totalSends,
      replies,
      replyRate: totalSends > 0 ? replies / totalSends : 0,
      positiveSentimentRate: replies > 0 ? positiveSentiment / replies : 0,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = outreachTemplateUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = db
    .select()
    .from(outreachTemplates)
    .where(and(eq(outreachTemplates.id, id), eq(outreachTemplates.tenantId, tenantId)))
    .get();

  if (!existing) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  db.update(outreachTemplates)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(outreachTemplates.id, id))
    .run();

  return Response.json({ success: true });
}
