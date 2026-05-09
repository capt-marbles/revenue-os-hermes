import { db } from "@/db";
import { briefingSnapshots } from "@/db/schema";
import {
  collectLiveCommandCenterState,
  getTodayBriefingSnapshot,
  shortfallReason,
} from "@/lib/command-center/assemble";
import { getTenantId } from "@/lib/tenant";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

export interface GeneratedBriefingSnapshot {
  id: string;
  tenantId: string;
  snapshotDate: string;
  status: "ready" | "partial" | "failed";
  summaryMarkdown: string;
  structuredPayload: string;
  queueCount: number;
  topOpportunityId: string | null;
  freshnessLabel: string;
  generatedAt: string;
  createdAt: string;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildSnapshotMarkdown(params: {
  queueCount: number;
  topTitle?: string | null;
  followUpShortfall: string | null;
  degradedSourceCount: number;
  sourceMixLabels: string[];
  learningSummary: string | null;
}) {
  const lines = [
    "## Morning Brief",
    "",
    params.queueCount > 0
      ? `You have **${params.queueCount} high-confidence opportunities** queued for today.`
      : "There are **no high-confidence opportunities** queued right now.",
    params.topTitle
      ? `Top priority right now: **${params.topTitle}**.`
      : "No single top opportunity is leading the queue yet.",
    params.degradedSourceCount > 0
      ? `**${params.degradedSourceCount} source${params.degradedSourceCount === 1 ? "" : "s"}** are degraded and may be reducing queue quality.`
      : "Source health looks stable.",
    params.sourceMixLabels.length > 0
      ? `Current source mix: ${params.sourceMixLabels.join(", ")}.`
      : "No source mix has been established yet.",
  ];

  if (params.learningSummary) {
    lines.push(params.learningSummary);
  }

  if (params.followUpShortfall) {
    lines.push("", params.followUpShortfall);
  }

  return lines.join("\n");
}

export function generateBriefingSnapshot(tenantId = getTenantId()): GeneratedBriefingSnapshot {
  const live = collectLiveCommandCenterState(tenantId);
  const queueCount = live.queue.availableCount;
  const degradedSourceCount = live.sourceHealth.length;
  const topOpportunityId = live.queue.items[0]?.id ?? null;
  const topTitle = live.queue.items[0]?.title ?? null;
  const snapshotDate = todayDate();
  const generatedAt = new Date().toISOString();
  const shortfall = shortfallReason(queueCount, live.queue.targetCount);
  const learningSummary = live.learning.sampleQualified && live.learning.insightCards[0]
    ? `Best current outreach signal: **${live.learning.insightCards[0].title}** at ${live.learning.insightCards[0].metric}.`
    : null;
  const summaryMarkdown = buildSnapshotMarkdown({
    queueCount,
    topTitle,
    followUpShortfall: shortfall,
    degradedSourceCount,
    sourceMixLabels: live.controls.sourceMix.map((source) => `${source.label} (${source.count})`),
    learningSummary,
  });

  const payload: GeneratedBriefingSnapshot = {
    id: ulid(),
    tenantId,
    snapshotDate,
    status: degradedSourceCount > 0 ? "partial" : "ready",
    summaryMarkdown,
    structuredPayload: JSON.stringify({
      queue: live.queue,
      sourceHealth: live.sourceHealth,
      controls: live.controls,
      learning: live.learning,
    }),
    queueCount,
    topOpportunityId,
    freshnessLabel: "fresh",
    generatedAt,
    createdAt: generatedAt,
  };

  const existing = getTodayBriefingSnapshot(tenantId);
  if (existing) {
    db.update(briefingSnapshots)
      .set({
        status: payload.status,
        summaryMarkdown: payload.summaryMarkdown,
        structuredPayload: payload.structuredPayload,
        queueCount: payload.queueCount,
        topOpportunityId: payload.topOpportunityId,
        freshnessLabel: payload.freshnessLabel,
        generatedAt: payload.generatedAt,
      })
      .where(eq(briefingSnapshots.id, existing.id))
      .run();

    return { ...payload, id: existing.id, createdAt: existing.createdAt };
  }

  db.insert(briefingSnapshots).values(payload).run();
  return payload;
}

export function ensureDailyBriefingSnapshot(tenantId = getTenantId()) {
  const existing = getTodayBriefingSnapshot(tenantId);
  if (existing) {
    return existing;
  }

  return generateBriefingSnapshot(tenantId);
}
