import { db } from "@/db";
import { outreachResponses, outreachSends } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { RegisteredTool } from "./types";

export const getOutreachStats: RegisteredTool = {
  definition: {
    name: "get_outreach_stats",
    description:
      "Get outreach volume and conversion metrics — sends, replies, meetings booked, bounce rate, daily average. Use to assess whether outreach is at the required volume.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days to look back (default 14)" },
      },
    },
  },
  scopes: ["cos", "steward", "outreach", "marketing"],
  async execute(input, tenantId) {
    const days = (input.days as number) ?? 14;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const stats = db
      .select({
        totalSends: sql<number>`count(distinct ${outreachSends.id})`,
        totalReplies: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'reply' then ${outreachResponses.id} end)`,
        totalBounces: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'bounce' then ${outreachResponses.id} end)`,
        totalMeetings: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'meeting_booked' then ${outreachResponses.id} end)`,
      })
      .from(outreachSends)
      .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
      .where(and(eq(outreachSends.tenantId, tenantId), gte(outreachSends.sentAt, since)))
      .get();

    if (!stats || stats.totalSends === 0) return `No outreach sends in the last ${days} days.`;

    const replyRate = Math.round((stats.totalReplies / stats.totalSends) * 100);
    const meetingRate = Math.round((stats.totalMeetings / stats.totalSends) * 100);

    const daily = db
      .select({
        date: sql<string>`date(${outreachSends.sentAt})`,
        sends: sql<number>`count(*)`,
      })
      .from(outreachSends)
      .where(and(eq(outreachSends.tenantId, tenantId), gte(outreachSends.sentAt, since)))
      .groupBy(sql`date(${outreachSends.sentAt})`)
      .orderBy(sql`date(${outreachSends.sentAt}) desc`)
      .limit(7)
      .all();

    const lines = [
      `## Outreach Stats (last ${days} days)\n`,
      `- **Sends:** ${stats.totalSends} (avg ${(stats.totalSends / days).toFixed(1)}/day)`,
      `- **Replies:** ${stats.totalReplies} (${replyRate}% reply rate)`,
      `- **Meetings booked:** ${stats.totalMeetings} (${meetingRate}%)`,
      `- **Bounces:** ${stats.totalBounces}`,
    ];

    if (daily.length > 0) {
      lines.push("\n**Daily sends (recent):**");
      for (const d of daily) lines.push(`- ${d.date}: ${d.sends}`);
    }

    return lines.join("\n");
  },
};
