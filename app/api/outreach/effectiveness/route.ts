import { NextRequest } from "next/server";
import { db } from "@/db";
import { outreachTemplates, outreachSends, outreachResponses } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = new URL(request.url);
  const segmentFilter = searchParams.get("segment");

  // Build conditions for sends
  const sendConditions = [eq(outreachSends.tenantId, tenantId)];
  if (segmentFilter) {
    sendConditions.push(eq(outreachSends.icpSegment, segmentFilter));
  }

  // Get all templates for this tenant
  const templates = db
    .select()
    .from(outreachTemplates)
    .where(eq(outreachTemplates.tenantId, tenantId))
    .all();

  // Get aggregated send + response data per template, grouped by ICP segment
  const stats = db
    .select({
      templateId: outreachSends.templateId,
      icpSegment: outreachSends.icpSegment,
      totalSends: sql<number>`count(distinct ${outreachSends.id})`,
      totalReplies: sql<number>`sum(case when ${outreachResponses.responseType} = 'reply' then 1 else 0 end)`,
      positiveSentiment: sql<number>`sum(case when ${outreachResponses.sentiment} = 'positive' then 1 else 0 end)`,
      neutralSentiment: sql<number>`sum(case when ${outreachResponses.sentiment} = 'neutral' then 1 else 0 end)`,
      negativeSentiment: sql<number>`sum(case when ${outreachResponses.sentiment} = 'negative' then 1 else 0 end)`,
    })
    .from(outreachSends)
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(and(...sendConditions))
    .groupBy(outreachSends.templateId, outreachSends.icpSegment)
    .all();

  // Group stats by template
  const templateMap = new Map<string, typeof stats>();
  for (const row of stats) {
    const existing = templateMap.get(row.templateId) ?? [];
    existing.push(row);
    templateMap.set(row.templateId, existing);
  }

  const result = templates.map((t) => {
    const segments = templateMap.get(t.id) ?? [];
    const totalSends = segments.reduce((acc, s) => acc + s.totalSends, 0);
    const totalReplies = segments.reduce((acc, s) => acc + (s.totalReplies ?? 0), 0);
    const positive = segments.reduce((acc, s) => acc + (s.positiveSentiment ?? 0), 0);
    const neutral = segments.reduce((acc, s) => acc + (s.neutralSentiment ?? 0), 0);
    const negative = segments.reduce((acc, s) => acc + (s.negativeSentiment ?? 0), 0);
    const sentimentTotal = positive + neutral + negative;

    return {
      templateId: t.id,
      templateName: t.name,
      channel: t.channel,
      totalSends,
      totalReplies,
      replyRate: totalSends > 0 ? totalReplies / totalSends : 0,
      avgSentiment: sentimentTotal > 0
        ? (positive - negative) / sentimentTotal // -1 to 1 scale
        : null,
      bySegment: segments.map((s) => ({
        segment: s.icpSegment,
        sends: s.totalSends,
        replies: s.totalReplies ?? 0,
        replyRate: s.totalSends > 0 ? (s.totalReplies ?? 0) / s.totalSends : 0,
        positiveSentiment: s.positiveSentiment ?? 0,
        neutralSentiment: s.neutralSentiment ?? 0,
        negativeSentiment: s.negativeSentiment ?? 0,
      })),
    };
  });

  return Response.json(result);
}
