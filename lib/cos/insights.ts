/**
 * Chief of Staff insight generation.
 *
 * The CoS analyzes pipeline data and writes structured observations.
 * It NEVER modifies agents directly — it writes insights for human review.
 *
 * Insight categories:
 * - pattern: recurring trend in pipeline data
 * - anomaly: unexpected deviation from baseline
 * - recommendation: proposed action based on pattern
 * - risk: potential problem that could degrade pipeline quality
 */

import { db } from "@/db";
import { cosInsights, opportunities, opportunitySources, outreachSends, outreachResponses, outreachTemplates } from "@/db/schema";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { ulid } from "ulid";
import { getTenantId } from "@/lib/tenant";

export interface InsightCreate {
  tenantId?: string;
  category: "pattern" | "anomaly" | "recommendation" | "risk";
  severity: "info" | "low" | "medium" | "high";
  title: string;
  detail: string;
  evidence?: Record<string, unknown>[];
  actionProposed?: string;
  experimentId?: string;
}

export function createInsight(params: InsightCreate): string {
  const tid = params.tenantId ?? getTenantId();
  const id = ulid();
  const now = new Date().toISOString();

  db.insert(cosInsights)
    .values({
      id,
      tenantId: tid,
      category: params.category,
      severity: params.severity,
      title: params.title,
      detail: params.detail,
      evidence: JSON.stringify(params.evidence ?? []),
      actionProposed: params.actionProposed ?? null,
      experimentId: params.experimentId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return id;
}

/**
 * Dismiss an insight.
 */
export function dismissInsight(insightId: string, tenantId?: string) {
  const tid = tenantId ?? getTenantId();
  db.update(cosInsights)
    .set({ status: "dismissed", actionStatus: "dismissed", updatedAt: new Date().toISOString() })
    .where(and(eq(cosInsights.id, insightId), eq(cosInsights.tenantId, tid)))
    .run();
}

/**
 * Mark insight action as approved (human approved the proposed action).
 */
export function approveInsightAction(insightId: string, tenantId?: string) {
  const tid = tenantId ?? getTenantId();
  db.update(cosInsights)
    .set({ actionStatus: "approved", updatedAt: new Date().toISOString() })
    .where(and(eq(cosInsights.id, insightId), eq(cosInsights.tenantId, tid)))
    .run();
}

/**
 * Mark insight action as applied.
 */
export function markInsightApplied(insightId: string, tenantId?: string) {
  const tid = tenantId ?? getTenantId();
  db.update(cosInsights)
    .set({ actionStatus: "applied", updatedAt: new Date().toISOString() })
    .where(and(eq(cosInsights.id, insightId), eq(cosInsights.tenantId, tid)))
    .run();
}

/**
 * Get active insights for a tenant.
 */
export function getActiveInsights(tenantId?: string, limit = 20) {
  const tid = tenantId ?? getTenantId();
  return db
    .select()
    .from(cosInsights)
    .where(and(eq(cosInsights.tenantId, tid), eq(cosInsights.status, "active")))
    .orderBy(desc(cosInsights.createdAt))
    .limit(limit)
    .all();
}

/**
 * Run the CoS analysis pipeline.
 *
 * Analyzes recent pipeline data and generates insights where patterns are found.
 * Called by a scheduled trigger (e.g., daily morning briefing or post-batch analysis).
 *
 * Returns the number of new insights created.
 */
export function runCoSAnalysis(tenantId?: string): number {
  const tid = tenantId ?? getTenantId();
  let newInsights = 0;

  // ── 1. Source bounce rate analysis ──
  // Check if sends from a particular source have higher bounce rates
  const sourceBounceRates = db
    .select({
      sourceType: opportunitySources.sourceType,
      totalSends: sql<number>`count(distinct ${outreachSends.id})`,
      totalBounces: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'bounce' then ${outreachResponses.id} end)`,
    })
    .from(outreachSends)
    .leftJoin(opportunities, eq(opportunities.id, outreachSends.contactRef))
    .leftJoin(opportunitySources, eq(opportunitySources.opportunityId, opportunities.id))
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(eq(outreachSends.tenantId, tid))
    .groupBy(opportunitySources.sourceType)
    .all();

  for (const row of sourceBounceRates) {
    if (!row.sourceType || row.totalSends < 5) continue;
    const bounceRate = row.totalBounces / row.totalSends;
    if (bounceRate > 0.2) {
      createInsight({
        category: "anomaly",
        severity: bounceRate > 0.4 ? "high" : "medium",
        title: `High bounce rate from ${row.sourceType}`,
        detail: `${row.totalBounces} bounces from ${row.totalSends} sends (${Math.round(bounceRate * 100)}%). Consider reducing confidence weight or enriching contacts before sending.`,
        evidence: [{ sourceType: row.sourceType, bounceRate, totalSends: row.totalSends, totalBounces: row.totalBounces }],
        actionProposed: `Reduce ${row.sourceType} source confidence weight or add email verification step before outreach.`,
      });
      newInsights++;
    }
  }

  // ── 2. Template reply rate analysis ──
  const templateStats = db
    .select({
      templateId: outreachTemplates.id,
      templateName: outreachTemplates.name,
      totalSends: sql<number>`count(distinct ${outreachSends.id})`,
      totalReplies: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'reply' then ${outreachResponses.id} end)`,
      totalMeetings: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'meeting_booked' then ${outreachResponses.id} end)`,
    })
    .from(outreachSends)
    .leftJoin(outreachTemplates, eq(outreachTemplates.id, outreachSends.templateId))
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(eq(outreachSends.tenantId, tid))
    .groupBy(outreachSends.templateId, outreachTemplates.id, outreachTemplates.name)
    .all();

  const qualifiedTemplates = templateStats.filter((t) => t.totalSends >= 10);
  if (qualifiedTemplates.length >= 2) {
    // Find best and worst performers
    const ranked = qualifiedTemplates
      .map((t) => ({
        ...t,
        replyRate: t.totalReplies / Math.max(t.totalSends, 1),
      }))
      .sort((a, b) => b.replyRate - a.replyRate);

    const best = ranked[0];
    const worst = ranked[ranked.length - 1];

    if (best.replyRate - worst.replyRate > 0.1) {
      createInsight({
        category: "pattern",
        severity: "low",
        title: `Template performance gap: ${best.templateName} vs ${worst.templateName}`,
        detail: `"${best.templateName}" has a ${Math.round(best.replyRate * 100)}% reply rate (${best.totalReplies}/${best.totalSends}) while "${worst.templateName}" is at ${Math.round(worst.replyRate * 100)}% (${worst.totalReplies}/${worst.totalSends}).`,
        evidence: ranked.map((t) => ({ template: t.templateName, replyRate: Math.round(t.replyRate * 100), sends: t.totalSends })),
        actionProposed: `Consider retiring "${worst.templateName}" or revising its copy to match patterns in "${best.templateName}".`,
      });
      newInsights++;
    }
  }

  // ── 3. Queue freshness check ──
  const staleOpportunities = db
    .select({ count: sql<number>`count(*)` })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, tid),
        sql`${opportunities.status} in ('discovered', 'enriched', 'scored', 'queued')`,
        sql`datetime(${opportunities.updatedAt}) < datetime('now', '-7 days')`,
      ),
    )
    .get()?.count ?? 0;

  if (staleOpportunities > 0) {
    createInsight({
      category: "risk",
      severity: staleOpportunities > 20 ? "high" : "low",
      title: `${staleOpportunities} stale opportunities in pipeline`,
      detail: `These opportunities haven't been updated in 7+ days and may contain outdated signals. Consider archiving or re-enriching.`,
      evidence: [{ staleCount: staleOpportunities }],
      actionProposed: `Archive opportunities stale > 14 days. Re-enrich those stale 7-14 days.`,
    });
    newInsights++;
  }

  // ── 4. Source coverage check ──
  const recentSources = db
    .select({
      sourceType: opportunitySources.sourceType,
      count: sql<number>`count(distinct ${opportunitySources.id})`,
    })
    .from(opportunitySources)
    .where(
      and(
        eq(opportunitySources.tenantId, tid),
        gte(opportunitySources.ingestedAt, sql`datetime('now', '-7 days')`),
      ),
    )
    .groupBy(opportunitySources.sourceType)
    .all();

  const sourceTypes = new Set(recentSources.map((s) => s.sourceType));
  const expectedSources = ["apollo", "phantombuster", "steam_bridge", "manual"];
  const missingSources = expectedSources.filter((s) => !sourceTypes.has(s));

  if (missingSources.length > 0 && recentSources.length > 0) {
    createInsight({
      category: "risk",
      severity: "info",
      title: `No signals from ${missingSources.join(", ")} in last 7 days`,
      detail: `Only ${sourceTypes.size} of ${expectedSources.length} expected sources are producing data. Pipeline may be missing opportunities.`,
      evidence: recentSources.map((s) => ({ source: s.sourceType, count: s.count })),
      actionProposed: `Check connectors for ${missingSources.join(", ")} — may be disconnected or auth expired.`,
    });
    newInsights++;
  }

  // ── 5. Follow-up gap detection ──
  const awaitingFollowUp = db
    .select({ count: sql<number>`count(*)` })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, tid),
        eq(opportunities.status, "sent_cold"),
        sql`datetime(${opportunities.updatedAt}) < datetime('now', '-5 days')`,
      ),
    )
    .get()?.count ?? 0;

  if (awaitingFollowUp > 10) {
    createInsight({
      category: "recommendation",
      severity: "medium",
      title: `${awaitingFollowUp} cold sends awaiting follow-up (5+ days)`,
      detail: `These opportunities were sent cold emails 5+ days ago with no response logged. Consider scheduling follow-up sequences.`,
      evidence: [{ awaitingFollowUp }],
      actionProposed: `Create a follow-up sequence for cold sends with no response after 5 days.`,
    });
    newInsights++;
  }

  return newInsights;
}
