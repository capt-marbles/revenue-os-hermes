import { db } from "@/db";
import {
  briefingSnapshots,
  connectors,
  introPaths,
  opportunities,
  opportunityDrafts,
  opportunitySources,
  opportunitySyncEvents,
  outreachResponses,
  outreachSends,
  outreachTemplates,
  cosInsights,
  experiments,
} from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

function getTodaySnapshotDate() {
  return new Date().toISOString().slice(0, 10);
}

export interface CommandCenterData {
  generatedAt: string;
  briefing: {
    status: "ready" | "partial" | "failed";
    freshnessLabel: string;
    summaryMarkdown: string;
    queueCount: number;
    shortfallReason: string | null;
  };
  queue: {
    targetCount: number;
    availableCount: number;
    items: CommandCenterOpportunity[];
  };
  sourceHealth: SourceHealthNotice[];
  controls: {
    freshnessPreset: string;
    sourceMix: Array<{
      sourceType: string;
      label: string;
      count: number;
    }>;
  };
  learning: {
    sampleQualified: boolean;
    insightCards: LearningInsightCard[];
    suppressedReason: string | null;
  };
  cosInsights: {
    total: number;
    pendingActions: number;
    items: Array<{
      id: string;
      category: string;
      severity: string;
      title: string;
      actionProposed: string | null;
      actionStatus: string | null;
      createdAt: string;
    }>;
  };
  experiments: {
    active: Array<{
      id: string;
      name: string;
      hypothesis: string;
      sampleSize: number;
      minSampleSize: number;
      metricName: string;
      startedAt: string;
    }>;
    recentConclusions: Array<{
      id: string;
      name: string;
      conclusion: string | null;
      treatmentWon: boolean;
      concludedAt: string;
    }>;
  };
  kanban: {
    totalTasks: number;
    byStatus: {
      triage: number;
      todo: number;
      ready: number;
      working: number;
      done: number;
      blocked: number;
      archived: number;
    };
    oldestReadyAgeMs: number | null;
    assignees: Array<{
      profile: string;
      taskCount: number;
      activeWorkers: number;
    }>;
  } | null; // null when Hermes not enabled or stats unavailable
}

export interface CommandCenterOpportunity {
  id: string;
  title: string;
  isSample: boolean;
  accountName: string | null;
  primaryContactName: string | null;
  opportunityType: string;
  status: string;
  recommendedPath: "cold" | "warm" | "none";
  score: number;
  confidence: number;
  rationaleSummary: string | null;
  sourceSummary: string | null;
  freshestSignalAt: string | null;
  draftStatus: string;
  syncStatus: string;
  explainability: {
    qualificationFacts: Array<{
      label: string;
      value: string;
    }>;
    qualificationSignals: Array<{
      label: string;
      detail: string;
      tone: "default" | "success" | "warning";
    }>;
    messaging: {
      primaryAngle: string | null;
      templateHint: string | null;
    };
    sources: Array<{
      sourceType: string;
      sourceRef: string;
      freshnessScore: number;
      rawSummary: string | null;
    }>;
    introPaths: Array<{
      connectorType: string;
      mutualName: string | null;
      confidence: number;
      freshness: number;
      status: string;
      pathSummary: string;
    }>;
  };
}

interface SourceHealthNotice {
  id: string;
  name: string;
  status: string;
  note: string;
}

interface LearningInsightCard {
  title: string;
  metric: string;
  detail: string;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function includesKeyword(values: string[], keywords: string[]) {
  return values.some((value) => keywords.some((keyword) => value.includes(keyword)));
}

function deriveQualificationSignals(params: {
  title: string;
  sourceSummary: string | null;
  rationaleSummary: string | null;
  signalType: string | null;
  metadata: Record<string, unknown>;
  sourceEvidence: Array<Record<string, unknown>>;
  introAvailable: boolean;
}) {
  const haystacks = [
    params.title,
    params.sourceSummary ?? "",
    params.rationaleSummary ?? "",
    params.signalType ?? "",
    ...params.sourceEvidence.flatMap((evidence) => [
      typeof evidence.title === "string" ? evidence.title : "",
      typeof evidence.headline === "string" ? evidence.headline : "",
      typeof evidence.competitor === "string" ? evidence.competitor : "",
      typeof evidence.provider === "string" ? evidence.provider : "",
    ]),
  ]
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  const tags = [
    ...normalizeTextList(params.metadata.tags),
    ...params.sourceEvidence.flatMap((evidence) => normalizeTextList(evidence.tags)),
  ].map((tag) => tag.toLowerCase());

  const campaign = typeof params.metadata.campaign === "string"
    ? params.metadata.campaign.toLowerCase()
    : "";

  const signals: Array<{
    label: string;
    detail: string;
    tone: "default" | "success" | "warning";
  }> = [];

  const multiplayerFit =
    includesKeyword(haystacks, ["multiplayer", "backend", "game server", "dedicated server", "live ops"]) ||
    includesKeyword(tags, ["multiplayer", "backend", "game-server", "dedicated-server", "liveops"]);
  if (multiplayerFit) {
    signals.push({
      label: "ICP fit",
      detail: "Looks like a multiplayer or backend-heavy game team, so infra and orchestration messaging is relevant.",
      tone: "success",
    });
  }

  const liveOps =
    includesKeyword(haystacks, ["live", "live ops", "evaluation", "migration plan", "reply received", "in flight"]) ||
    includesKeyword(tags, ["live", "liveops", "production"]) ||
    String(params.metadata.liveStatus ?? "").toLowerCase() === "live";
  if (liveOps) {
    signals.push({
      label: "Lifecycle stage",
      detail: "Already operating or close to launch, so reliability and cost-of-running-now angles matter more than greenfield setup copy.",
      tone: "default",
    });
  }

  const displacementPain =
    includesKeyword(haystacks, ["shutdown", "sunset", "migration", "reevaluation", "re-evaluating", "platform changes"]) ||
    includesKeyword(tags, ["migration", "shutdown", "displacement"]) ||
    includesKeyword([campaign], ["hathora", "multiplay", "displacement"]);
  if (displacementPain) {
    signals.push({
      label: "Current pain",
      detail: "There is active migration or shutdown pressure, so the right template should lead with switching urgency rather than generic prospecting.",
      tone: "warning",
    });
  }

  if (params.introAvailable) {
    signals.push({
      label: "Path advantage",
      detail: "A warm path exists, so an intro-request template is stronger than a standard cold opener.",
      tone: "success",
    });
  }

  if (signals.length === 0) {
    signals.push({
      label: "Qualification basis",
      detail: "This is mostly qualified by source freshness and reachable contact data. It still needs stronger business context before using a highly specific template.",
      tone: "default",
    });
  }

  return signals.slice(0, 4);
}

function deriveQualificationFacts(params: {
  metadata: Record<string, unknown>;
  sourceEvidence: Array<Record<string, unknown>>;
}) {
  const firstEvidence = params.sourceEvidence[0] ?? {};
  const product = firstNonEmptyString(
    params.metadata.product,
    params.metadata.productDescription,
    firstEvidence.product,
    firstEvidence.productDescription,
  );
  const liveStatus = firstNonEmptyString(
    params.metadata.liveStatus,
    firstEvidence.liveStatus,
  );
  const whyNow = firstNonEmptyString(
    params.metadata.whyNow,
    firstEvidence.whyNow,
  );
  const proof = firstNonEmptyString(
    params.metadata.proof,
    firstEvidence.proof,
    firstEvidence.headline,
  );

  const painPoints = [
    ...normalizeTextList(params.metadata.painPoints),
    ...params.sourceEvidence.flatMap((evidence) => normalizeTextList(evidence.painPoints)),
  ];

  const facts: Array<{ label: string; value: string }> = [];

  if (product) {
    facts.push({ label: "What they build", value: product });
  }

  if (liveStatus) {
    facts.push({ label: "Stage", value: liveStatus });
  }

  if (painPoints.length > 0) {
    facts.push({ label: "Pain point", value: painPoints[0] });
  }

  if (whyNow) {
    facts.push({ label: "Why now", value: whyNow });
  }

  if (proof) {
    facts.push({ label: "Evidence", value: proof });
  }

  return facts.slice(0, 5);
}

function deriveMessagingHint(signals: Array<{ label: string; detail: string }>, recommendedPath: "cold" | "warm" | "none") {
  const hasDisplacementPain = signals.some((signal) => signal.label === "Current pain");
  const hasMultiplayerFit = signals.some((signal) => signal.label === "ICP fit");
  const hasLiveOps = signals.some((signal) => signal.label === "Lifecycle stage");
  const hasWarmPath = signals.some((signal) => signal.label === "Path advantage");

  if (recommendedPath === "warm" || hasWarmPath) {
    return {
      primaryAngle: "Warm intro around active infrastructure re-evaluation",
      templateHint: "Use an intro-request template that references the mutual connection and the timing of their migration decision.",
    };
  }

  if (hasDisplacementPain && hasLiveOps) {
    return {
      primaryAngle: "Migration urgency for a live game team",
      templateHint: "Use a migration/cost-savings template focused on de-risking a live switch, not a generic discovery email.",
    };
  }

  if (hasDisplacementPain && hasMultiplayerFit) {
    return {
      primaryAngle: "Competitor-displacement outreach",
      templateHint: "Use a shutdown or platform-change template that leads with migration pain and multiplayer backend fit.",
    };
  }

  if (hasMultiplayerFit) {
    return {
      primaryAngle: "Multiplayer backend fit",
      templateHint: "Use a template centered on backend complexity, orchestration, and speed-to-launch for multiplayer teams.",
    };
  }

  return {
    primaryAngle: "General outbound qualification",
    templateHint: "Use a lightweight exploratory template until stronger pain or lifecycle evidence is attached.",
  };
}

export function labelSource(sourceType: string) {
  return sourceType
    .split(/[_-]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function shortfallReason(itemCount: number, targetCount: number) {
  if (itemCount >= targetCount) return null;
  if (itemCount === 0) return "No high-confidence opportunities are queued yet. The system should shift your day toward follow-ups and signal review.";
  return `Only ${itemCount} opportunities cleared the current confidence bar, so the queue is intentionally short instead of padded with weaker leads.`;
}

export function buildFallbackBriefing(
  itemCount: number,
  followUpCount: number,
  degradedSources: number,
): Pick<CommandCenterData["briefing"], "status" | "freshnessLabel" | "summaryMarkdown" | "queueCount" | "shortfallReason"> {
  const shortfall = shortfallReason(itemCount, 20);
  const lines = [
    `## Morning Brief`,
    "",
    itemCount > 0
      ? `You have **${itemCount} high-confidence opportunities** in the queue today.`
      : "There are **no high-confidence opportunities** queued right now.",
    followUpCount > 0
      ? `There are **${followUpCount} active follow-ups** that can keep pipeline moving if new lead quality is thin.`
      : "Follow-up pressure is light right now.",
    degradedSources > 0
      ? `**${degradedSources} source${degradedSources === 1 ? "" : "s"}** look degraded, which may be suppressing queue quality.`
      : "Source health looks stable.",
  ];

  if (shortfall) {
    lines.push("", shortfall);
  }

  return {
    status: degradedSources > 0 ? "partial" : "ready",
    freshnessLabel: "live",
    summaryMarkdown: lines.join("\n"),
    queueCount: itemCount,
    shortfallReason: shortfall,
  };
}

export interface LiveCommandCenterState {
  queue: CommandCenterData["queue"];
  sourceHealth: CommandCenterData["sourceHealth"];
  controls: CommandCenterData["controls"];
  learning: CommandCenterData["learning"];
  cosInsights: CommandCenterData["cosInsights"];
  experiments: CommandCenterData["experiments"];
  generatedAt: string;
  fallbackBriefing: CommandCenterData["briefing"];
}

export function collectLiveCommandCenterState(tenantId = getTenantId()): LiveCommandCenterState {
  const queuedOpportunities = db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, tenantId),
        sql`${opportunities.status} != 'archived'`,
        sql`${opportunities.status} != 'disqualified'`
      ),
    )
    .orderBy(desc(opportunities.score), desc(opportunities.freshestSignalAt), desc(opportunities.updatedAt))
    .limit(20)
    .all();

  const opportunityIds = queuedOpportunities.map((item) => item.id);
  const [sources, drafts, intros, syncs, connectorRows] = opportunityIds.length > 0
    ? [
        db.select().from(opportunitySources).where(inArray(opportunitySources.opportunityId, opportunityIds)).all(),
        db.select().from(opportunityDrafts).where(inArray(opportunityDrafts.opportunityId, opportunityIds)).all(),
        db.select().from(introPaths).where(inArray(introPaths.opportunityId, opportunityIds)).all(),
        db.select().from(opportunitySyncEvents).where(inArray(opportunitySyncEvents.opportunityId, opportunityIds)).all(),
        db.select().from(connectors).where(eq(connectors.tenantId, tenantId)).all(),
      ]
    : [
        [],
        [],
        [],
        [],
        db.select().from(connectors).where(eq(connectors.tenantId, tenantId)).all(),
      ];

  const sourceMap = new Map<string, typeof sources>();
  for (const row of sources) {
    const bucket = sourceMap.get(row.opportunityId) ?? [];
    bucket.push(row);
    sourceMap.set(row.opportunityId, bucket);
  }

  const draftMap = new Map<string, typeof drafts[number]>();
  for (const row of drafts) {
    const existing = draftMap.get(row.opportunityId);
    if (!existing || existing.createdAt < row.createdAt) {
      draftMap.set(row.opportunityId, row);
    }
  }

  const introMap = new Map<string, typeof intros>();
  for (const row of intros) {
    const bucket = introMap.get(row.opportunityId) ?? [];
    bucket.push(row);
    introMap.set(row.opportunityId, bucket);
  }

  const syncMap = new Map<string, typeof syncs[number]>();
  for (const row of syncs) {
    const existing = syncMap.get(row.opportunityId);
    if (!existing || existing.createdAt < row.createdAt) {
      syncMap.set(row.opportunityId, row);
    }
  }

  const queueItems: CommandCenterOpportunity[] = queuedOpportunities.map((row) => {
    const itemSources = sourceMap.get(row.id) ?? [];
    const itemIntros = introMap.get(row.id) ?? [];
    const latestDraft = draftMap.get(row.id);
    const latestSync = syncMap.get(row.id);
    const bestIntro = [...itemIntros].sort((a, b) => b.confidence - a.confidence)[0];
    const recommendedPath =
      row.primaryPath !== "none"
        ? (row.primaryPath as "cold" | "warm" | "none")
        : bestIntro && bestIntro.status === "available" && bestIntro.confidence >= 70
          ? "warm"
          : "cold";
    const rowMetadata = parseJsonObject(row.metadata);
    const sourceEvidence = itemSources.map((source) => parseJsonObject(source.sourceEvidence));
    const qualificationSignals = deriveQualificationSignals({
      title: row.title,
      sourceSummary: row.sourceSummary,
      rationaleSummary: row.rationaleSummary,
      signalType: typeof rowMetadata.signalType === "string" ? rowMetadata.signalType : null,
      metadata: rowMetadata,
      sourceEvidence,
      introAvailable: !!bestIntro && bestIntro.status === "available",
    });
    const qualificationFacts = deriveQualificationFacts({
      metadata: rowMetadata,
      sourceEvidence,
    });
    const messaging = deriveMessagingHint(qualificationSignals, recommendedPath);

    return {
      id: row.id,
      title: row.title,
      isSample: rowMetadata.seeded === true,
      accountName: row.accountName,
      primaryContactName: row.primaryContactName,
      opportunityType: row.opportunityType,
      status: row.status,
      recommendedPath,
      score: Math.round(row.score),
      confidence: Math.round(row.confidence),
      rationaleSummary: row.rationaleSummary,
      sourceSummary: row.sourceSummary,
      freshestSignalAt: row.freshestSignalAt,
      draftStatus: latestDraft?.status ?? "missing",
      syncStatus: latestSync?.status ?? "pending",
      explainability: {
        qualificationFacts,
        qualificationSignals,
        messaging,
        sources: itemSources.map((source) => ({
          sourceType: source.sourceType,
          sourceRef: source.sourceRef,
          freshnessScore: Math.round(source.freshnessScore * 100),
          rawSummary: source.rawSummary,
        })),
        introPaths: itemIntros.map((intro) => ({
          connectorType: intro.connectorType,
          mutualName: intro.mutualName,
          confidence: Math.round(intro.confidence),
          freshness: Math.round(intro.freshness),
          status: intro.status,
          pathSummary: intro.pathSummary,
        })),
      },
    };
  });

  const sourceMixMap = new Map<string, number>();
  for (const row of sources) {
    sourceMixMap.set(row.sourceType, (sourceMixMap.get(row.sourceType) ?? 0) + 1);
  }

  const sourceMix = Array.from(sourceMixMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([sourceType, count]) => ({
      sourceType,
      label: labelSource(sourceType),
      count,
    }));

  const sourceHealth: SourceHealthNotice[] = connectorRows
    .filter((connector) => connector.status !== "connected")
    .map((connector) => ({
      id: connector.id,
      name: connector.name,
      status: connector.status ?? "disconnected",
      note:
        connector.status === "error"
          ? "Connector is erroring and may be starving the queue."
          : "Connector is not connected, so its source lane is currently inactive.",
    }));

  const followUpCount = db
    .select({ count: sql<number>`count(*)` })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, tenantId),
        sql`${opportunities.status} in ('active_followup', 'intro_requested', 'intro_made')`,
      ),
    )
    .get()?.count ?? 0;

  const sendStats = db
    .select({
      templateId: outreachSends.templateId,
      templateName: outreachTemplates.name,
      totalSends: sql<number>`count(distinct ${outreachSends.id})`,
      totalReplies: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'reply' then ${outreachResponses.id} end)`,
      totalMeetings: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'meeting_booked' then ${outreachResponses.id} end)`,
    })
    .from(outreachSends)
    .leftJoin(outreachTemplates, eq(outreachTemplates.id, outreachSends.templateId))
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(eq(outreachSends.tenantId, tenantId))
    .groupBy(outreachSends.templateId, outreachTemplates.name)
    .orderBy(desc(sql`count(distinct ${outreachSends.id})`))
    .all();

  const qualifiedLearningRows = sendStats.filter((row) => row.totalSends >= 5);
  const learningSuppressed = qualifiedLearningRows.length === 0;
  const learningCards: LearningInsightCard[] = learningSuppressed
    ? []
    : qualifiedLearningRows.slice(0, 3).map((row) => ({
        title: row.templateName ?? "Unnamed template",
        metric: `${Math.round((row.totalReplies / Math.max(row.totalSends, 1)) * 100)}% reply rate`,
        detail: `${row.totalReplies} replies and ${row.totalMeetings} meetings from ${row.totalSends} sends.`,
      }));

  // ── CoS Insights ──
  const activeInsights = db
    .select({
      id: cosInsights.id,
      category: cosInsights.category,
      severity: cosInsights.severity,
      title: cosInsights.title,
      actionProposed: cosInsights.actionProposed,
      actionStatus: cosInsights.actionStatus,
      status: cosInsights.status,
      createdAt: cosInsights.createdAt,
    })
    .from(cosInsights)
    .where(eq(cosInsights.tenantId, tenantId))
    .all();

  const liveInsights = activeInsights.filter((i) => i.status !== "dismissed");

  // ── Experiments ──
  const activeExperiments = db
    .select({
      id: experiments.id,
      name: experiments.name,
      hypothesis: experiments.hypothesis,
      sampleSize: experiments.sampleSize,
      minSampleSize: experiments.minSampleSize,
      metricName: experiments.metricName,
      startDate: experiments.startDate,
    })
    .from(experiments)
    .where(and(eq(experiments.tenantId, tenantId), eq(experiments.status, "running")))
    .all();

  const concludedExperiments = db
    .select({
      id: experiments.id,
      name: experiments.name,
      conclusion: experiments.conclusion,
      controlMetricValue: experiments.controlMetricValue,
      treatmentMetricValue: experiments.treatmentMetricValue,
      metricDirection: experiments.metricDirection,
      concludedAt: experiments.concludedAt,
    })
    .from(experiments)
    .where(and(eq(experiments.tenantId, tenantId), eq(experiments.status, "completed")))
    .orderBy(desc(experiments.concludedAt))
    .limit(5)
    .all();

  return {
    queue: {
      targetCount: 20,
      availableCount: queueItems.length,
      items: queueItems,
    },
    sourceHealth,
    controls: {
      freshnessPreset: "Last 7 days",
      sourceMix,
    },
    learning: {
      sampleQualified: !learningSuppressed,
      insightCards: learningCards,
      suppressedReason: learningSuppressed
        ? "Not enough attributed outreach volume yet to show trustworthy learning insights."
        : null,
    },
    cosInsights: {
      total: liveInsights.length,
      pendingActions: liveInsights.filter((i) => i.actionProposed && !i.actionStatus).length,
      items: liveInsights.slice(0, 10).map((i) => ({
        id: i.id,
        category: i.category,
        severity: i.severity,
        title: i.title,
        actionProposed: i.actionProposed,
        actionStatus: i.actionStatus,
        createdAt: i.createdAt,
      })),
    },
    experiments: {
      active: activeExperiments.map((e) => ({
        id: e.id,
        name: e.name,
        hypothesis: e.hypothesis,
        sampleSize: e.sampleSize,
        minSampleSize: e.minSampleSize,
        metricName: e.metricName,
        startedAt: e.startDate ?? "",
      })),
      recentConclusions: concludedExperiments.map((e) => {
        const isHigherBetter = e.metricDirection === "higher_is_better";
        const treatmentWon = isHigherBetter
          ? (e.treatmentMetricValue ?? 0) > (e.controlMetricValue ?? 0)
          : (e.treatmentMetricValue ?? 0) < (e.controlMetricValue ?? 0);
        return {
          id: e.id,
          name: e.name,
          conclusion: e.conclusion,
          treatmentWon,
          concludedAt: e.concludedAt ?? "",
        };
      }),
    },
    generatedAt: new Date().toISOString(),
    fallbackBriefing: buildFallbackBriefing(queueItems.length, followUpCount, sourceHealth.length),
  };
}

export async function assembleCommandCenter(): Promise<CommandCenterData> {
  const tenantId = getTenantId();
  const liveState = collectLiveCommandCenterState(tenantId);
  const latestSnapshot = db
    .select()
    .from(briefingSnapshots)
    .where(eq(briefingSnapshots.tenantId, tenantId))
    .orderBy(desc(briefingSnapshots.generatedAt))
    .get();

  const briefing = latestSnapshot
    ? {
        status: latestSnapshot.status as "ready" | "partial" | "failed",
        freshnessLabel: latestSnapshot.freshnessLabel,
        summaryMarkdown: latestSnapshot.summaryMarkdown,
        queueCount: latestSnapshot.queueCount,
        shortfallReason: shortfallReason(liveState.queue.availableCount, liveState.queue.targetCount),
      }
    : liveState.fallbackBriefing;

  // Fetch Hermes Kanban stats if enabled
  let kanban: CommandCenterData["kanban"] = null;
  if (process.env["HERMES_KANBAN_ENABLED"] === "true") {
    try {
      const { getHermesBoardStats } = await import("@/lib/hermes/hermes-board-stats");
      const stats = await getHermesBoardStats();
      kanban = { ...stats.kanban, assignees: stats.assignees };
    } catch (err) {
      console.error("[CommandCenter] Failed to fetch Hermes kanban stats:", err);
      kanban = null;
    }
  }

  return {
    generatedAt: latestSnapshot?.generatedAt ?? liveState.generatedAt,
    briefing,
    queue: liveState.queue,
    sourceHealth: liveState.sourceHealth,
    controls: liveState.controls,
    learning: liveState.learning,
    cosInsights: liveState.cosInsights,
    experiments: liveState.experiments,
    kanban,
  };
}

export function getLatestBriefingSnapshot(tenantId = getTenantId()) {
  return db
    .select()
    .from(briefingSnapshots)
    .where(eq(briefingSnapshots.tenantId, tenantId))
    .orderBy(desc(briefingSnapshots.generatedAt))
    .get();
}

export function getTodayBriefingSnapshot(tenantId = getTenantId()) {
  return db
    .select()
    .from(briefingSnapshots)
    .where(
      and(
        eq(briefingSnapshots.tenantId, tenantId),
        eq(briefingSnapshots.snapshotDate, getTodaySnapshotDate()),
      ),
    )
    .get();
}
