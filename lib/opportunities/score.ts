import type { OpportunityCandidate } from "./candidate";
import type { PipelineConfig } from "@/lib/pipeline/types";
import { DEFAULT_PIPELINE_CONFIG } from "@/lib/pipeline/types";

export interface OpportunityScoreResult {
  baseScore: number;
  confidence: number;
  rationale: string[];
  /** The pipeline config ID used for this scoring (for attribution) */
  pipelineConfigId?: string;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Score an opportunity candidate using config-driven weights.
 *
 * @param candidate  The opportunity to score
 * @param pipelineConfig  Active pipeline config (falls back to defaults)
 * @param pipelineConfigId  ID of the pipeline config for attribution
 */
export function scoreOpportunityCandidate(
  candidate: OpportunityCandidate,
  pipelineConfig?: PipelineConfig | null,
  pipelineConfigId?: string,
): OpportunityScoreResult {
  const config = {
    ...DEFAULT_PIPELINE_CONFIG,
    ...pipelineConfig,
    scoring: {
      ...DEFAULT_PIPELINE_CONFIG.scoring,
      ...pipelineConfig?.scoring,
    },
  };

  const w = config.scoring!;

  let score = w.baseScore ?? 25;
  let confidence = config.minConfidence ?? 40;
  const rationale: string[] = [];

  // Freshness scoring
  if (candidate.freshness >= 0.8) {
    score += w.freshnessHigh ?? 25;
    confidence += 20;
    rationale.push("Fresh source evidence");
  } else if (candidate.freshness >= 0.5) {
    score += w.freshnessMedium ?? 12;
    confidence += 10;
    rationale.push("Recent source evidence");
  } else {
    rationale.push("Source evidence is aging");
  }

  // Warm intro path
  if (candidate.suggestedPath === "warm") {
    score += w.warmPath ?? 18;
    confidence += 10;
    rationale.push("Warm intro path available");
  }

  // Contact available
  if (candidate.contactEmail || candidate.contactLinkedin) {
    score += w.contactAvailable ?? 10;
    confidence += 8;
    rationale.push("Reachable contact details present");
  }

  // Account and contact identified
  if (candidate.accountName && candidate.contactName) {
    score += 8;
    rationale.push("Account and contact are identified");
  }

  // Signal type match
  if (candidate.signalType) {
    score += w.lifecycleFit ?? 8;
    rationale.push(`Matched signal type: ${candidate.signalType}`);
  }

  // Source confidence adjustment
  const sourceConf = config.sources?.[candidate.sourceType]?.confidence;
  if (sourceConf !== undefined && sourceConf < 1) {
    // Discount score from lower-confidence sources
    score = Math.round(score * (0.7 + sourceConf * 0.3));
    rationale.push(`Source confidence adjusted (${candidate.sourceType}: ${Math.round(sourceConf * 100)}%)`);
  }

  return {
    baseScore: clamp(score),
    confidence: clamp(confidence),
    rationale,
    pipelineConfigId,
  };
}

/**
 * Check if an opportunity meets the minimum thresholds.
 */
export function meetsThresholds(
  result: OpportunityScoreResult,
  pipelineConfig?: PipelineConfig | null,
): boolean {
  const config = { ...DEFAULT_PIPELINE_CONFIG, ...pipelineConfig };
  return result.baseScore >= (config.minScore ?? 50) && result.confidence >= (config.minConfidence ?? 40);
}
