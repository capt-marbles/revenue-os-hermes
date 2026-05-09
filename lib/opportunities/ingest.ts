import { db } from "@/db";
import { dispatchStageActions } from "@/lib/pipeline/stage-actions";
import {
  introPaths,
  opportunities,
  opportunitySources,
} from "@/db/schema";
import {
  normalizeOpportunityCandidate,
  type OpportunityCandidate,
} from "@/lib/opportunities/candidate";
import { findExistingOpportunity } from "@/lib/opportunities/dedupe";
import { scoreOpportunityCandidate } from "@/lib/opportunities/score";
import { getActivePipelineConfig, resolvePipelineConfigForOpportunity } from "@/lib/pipeline/config";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";

export interface IngestOpportunityInput {
  tenantId: string;
  candidate: OpportunityCandidate;
}

export interface IngestOpportunityResult {
  opportunityId: string;
  created: boolean;
  dedupeReason: string;
  status: string;
}

function isoNow() {
  return new Date().toISOString();
}

function toOpportunityTitle(candidate: OpportunityCandidate) {
  if (candidate.title) return candidate.title;
  if (candidate.accountName && candidate.contactName) {
    return `${candidate.accountName} · ${candidate.contactName}`;
  }
  if (candidate.accountName) return candidate.accountName;
  if (candidate.contactName) return candidate.contactName;
  return candidate.externalRef;
}

function toSourceSummary(candidate: OpportunityCandidate) {
  return `${candidate.sourceType}: ${candidate.summary}`;
}

function toOpportunityType(candidate: OpportunityCandidate) {
  if (candidate.signalType === "inbound") return "inbound";
  if (candidate.signalType === "signal") return "signal";
  return "outbound";
}

function clampScoreForQueue(score: number, confidence: number) {
  if (score >= 65 && confidence >= 55) return "queued";
  if (score >= 45) return "scored";
  return "enriched";
}

function upsertIntroSignal(
  tenantId: string,
  opportunityId: string,
  candidate: OpportunityCandidate,
) {
  const evidence = candidate.sourceEvidence ?? {};
  const mutualName =
    typeof evidence.mutualName === "string" ? evidence.mutualName : null;
  const pathSummary =
    typeof evidence.pathSummary === "string" ? evidence.pathSummary : null;

  if (candidate.suggestedPath !== "warm" || !pathSummary) {
    return;
  }

  const existing = db
    .select()
    .from(introPaths)
    .where(
      and(
        eq(introPaths.tenantId, tenantId),
        eq(introPaths.opportunityId, opportunityId),
      ),
    )
    .get();

  const confidence =
    typeof evidence.introConfidence === "number" ? evidence.introConfidence : 72;
  const freshness =
    typeof evidence.introFreshness === "number" ? evidence.introFreshness : Math.round(candidate.freshness * 100);
  const connectorType =
    typeof evidence.connectorType === "string" ? evidence.connectorType : candidate.sourceType;
  const payload = {
    tenantId,
    opportunityId,
    connectorType,
    mutualRef: typeof evidence.mutualRef === "string" ? evidence.mutualRef : null,
    mutualName,
    pathSummary,
    confidence,
    freshness,
    status: "available" as const,
    evidence: JSON.stringify(evidence),
    updatedAt: isoNow(),
  };

  if (existing) {
    db.update(introPaths)
      .set(payload)
      .where(eq(introPaths.id, existing.id))
      .run();
    return;
  }

  db.insert(introPaths)
    .values({
      id: ulid(),
      createdAt: isoNow(),
      ...payload,
    })
    .run();
}

export function ingestOpportunityCandidate({
  tenantId,
  candidate,
}: IngestOpportunityInput): IngestOpportunityResult {
  const normalized = normalizeOpportunityCandidate(candidate);
  const existing = findExistingOpportunity(tenantId, normalized);
  const opportunityId = existing?.id ?? ulid();
  // Use experiment-aware routing if an experiment is running
  const activePipeline = resolvePipelineConfigForOpportunity(opportunityId, tenantId);
  const score = scoreOpportunityCandidate(normalized, activePipeline.config, activePipeline.id);
  const now = isoNow();
  const title = toOpportunityTitle(normalized);
  const scoreStatus = clampScoreForQueue(score.baseScore, score.confidence);
  const primaryPath = normalized.suggestedPath ?? "none";

  let created = false;

  if (existing) {
    const current = db
      .select()
      .from(opportunities)
      .where(
        and(
          eq(opportunities.tenantId, tenantId),
          eq(opportunities.id, existing.id),
        ),
      )
      .get();

    if (!current) {
      throw new Error(`Opportunity ${existing.id} disappeared during merge`);
    }

    db.update(opportunities)
      .set({
        title: current.title || title,
        accountName: current.accountName || normalized.accountName,
        primaryContactName: current.primaryContactName || normalized.contactName,
        primaryContactEmail: current.primaryContactEmail || normalized.contactEmail,
        primaryContactLinkedin: current.primaryContactLinkedin || normalized.contactLinkedin,
        opportunityType: current.opportunityType || toOpportunityType(normalized),
        status:
          current.status === "active_followup" || current.status === "approved"
            ? current.status
            : scoreStatus,
        primaryPath:
          current.primaryPath !== "none" ? current.primaryPath : primaryPath,
        score: Math.max(current.score, score.baseScore),
        confidence: Math.max(current.confidence, score.confidence),
        rationaleSummary: score.rationale.join(" · "),
        sourceSummary: toSourceSummary(normalized),
        freshestSignalAt: now,
        lastActivityAt: now,
        metadata: JSON.stringify({
          ...(current.metadata ? JSON.parse(current.metadata) : {}),
          lastDedupeReason: existing.reason,
          lastSignalType: normalized.signalType,
        }),
        updatedAt: now,
      })
      .where(eq(opportunities.id, existing.id))
      .run();
  } else {
    created = true;
    db.insert(opportunities)
      .values({
        id: opportunityId,
        tenantId,
        title,
        accountName: normalized.accountName,
        primaryContactName: normalized.contactName,
        primaryContactEmail: normalized.contactEmail,
        primaryContactLinkedin: normalized.contactLinkedin,
        opportunityType: toOpportunityType(normalized),
        status: scoreStatus,
        primaryPath,
        score: score.baseScore,
        confidence: score.confidence,
        rationaleSummary: score.rationale.join(" · "),
        sourceSummary: toSourceSummary(normalized),
        freshestSignalAt: now,
        lastActivityAt: now,
        metadata: JSON.stringify({
          signalType: normalized.signalType,
          createdFrom: normalized.sourceType,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const existingSource = db
    .select()
    .from(opportunitySources)
    .where(
      and(
        eq(opportunitySources.tenantId, tenantId),
        eq(opportunitySources.sourceType, normalized.sourceType),
        eq(opportunitySources.sourceRef, normalized.externalRef),
      ),
    )
    .get();

  const sourcePayload = {
    tenantId,
    opportunityId,
    sourceType: normalized.sourceType,
    sourceRef: normalized.externalRef,
    payloadFingerprint: normalized.rawPayloadRef ?? `${normalized.sourceType}:${normalized.externalRef}`,
    freshnessScore: normalized.freshness,
    rawSummary: normalized.summary,
    sourceEvidence: JSON.stringify(normalized.sourceEvidence ?? {}),
    ingestedAt: now,
  };

  if (existingSource) {
    db.update(opportunitySources)
      .set(sourcePayload)
      .where(eq(opportunitySources.id, existingSource.id))
      .run();
  } else {
    db.insert(opportunitySources)
      .values({
        id: ulid(),
        createdAt: now,
        ...sourcePayload,
      })
      .run();
  }

  upsertIntroSignal(tenantId, opportunityId, normalized);

  // Dispatch pipeline stage actions when a new opportunity is created
  if (created) {
    try {
      dispatchStageActions({
        tenantId,
        opportunityId,
        opportunityTitle: title,
        fromStatus: "",
        toStatus: scoreStatus,
      });
    } catch (err) {
      console.error("[stage-actions] dispatch failed:", err);
    }
  }

  return {
    opportunityId,
    created,
    dedupeReason: existing?.reason ?? "created",
    status: scoreStatus,
  };
}
