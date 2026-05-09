import { db } from "@/db";
import { outreachSends, outreachTemplates, outreachResponses } from "@/db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET() {
  const tenantId = getTenantId();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Recent sends without responses (candidates for checking)
  const unreplied = db
    .select({
      sendId: outreachSends.id,
      contactRef: outreachSends.contactRef,
      contactName: outreachSends.contactName,
      companyName: outreachSends.companyName,
      templateId: outreachSends.templateId,
      sentAt: outreachSends.sentAt,
      channel: outreachSends.channel,
    })
    .from(outreachSends)
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(
      and(
        eq(outreachSends.tenantId, tenantId),
        gte(outreachSends.sentAt, sevenDaysAgo),
        sql`${outreachResponses.id} IS NULL`
      )
    )
    .orderBy(desc(outreachSends.sentAt))
    .limit(50)
    .all();

  // Current template effectiveness for comparison
  const effectiveness = db
    .select({
      templateId: outreachSends.templateId,
      templateName: outreachTemplates.name,
      totalSends: sql<number>`count(distinct ${outreachSends.id})`,
      totalReplies: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'reply' then ${outreachResponses.id} end)`,
    })
    .from(outreachSends)
    .leftJoin(outreachTemplates, eq(outreachSends.templateId, outreachTemplates.id))
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(eq(outreachSends.tenantId, tenantId))
    .groupBy(outreachSends.templateId)
    .all();

  return Response.json({
    unrepliedSends: unreplied,
    templateEffectiveness: effectiveness.map((t) => ({
      ...t,
      replyRate: t.totalSends > 0 ? Math.round((t.totalReplies / t.totalSends) * 100) : 0,
    })),
  });
}
