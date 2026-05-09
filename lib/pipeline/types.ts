/**
 * Pipeline configuration types.
 *
 * A PipelineConfig is a named snapshot of agent prompts, scoring weights,
 * thresholds, and source settings. Every agent run and outreach send
 * tags itself with the active config, enabling outcome attribution and A/B
 * experiments.
 */

export interface PipelineScoringWeights {
  /** Base score for opportunity candidates (default: 25) */
  baseScore?: number;
  /** Weight for freshness >= 0.8 (default: 25) */
  freshnessHigh?: number;
  /** Weight for freshness >= 0.5 (default: 12) */
  freshnessMedium?: number;
  /** Weight for warm intro path (default: 18) */
  warmPath?: number;
  /** Weight for contact available (email or LinkedIn) (default: 10) */
  contactAvailable?: number;
  /** Weight for strong rationale (default: 15) */
  strongRationale?: number;
  /** Weight for competitor complaint (default: 20) */
  competitorComplaint?: number;
  /** Weight for lifecycle signal (pre-launch/early live) (default: 10) */
  lifecycleFit?: number;
  /** Weight for team size in range (default: 8) */
  teamSizeFit?: number;
}

export interface PipelineSourceConfig {
  enabled?: boolean;
  /** Confidence weight 0-1 applied to signals from this source (default: 1.0) */
  confidence?: number;
  /** Source-specific notes or filter criteria */
  filterCriteria?: Record<string, unknown>;
}

export interface PipelineAgentConfig {
  /** Agent slug (e.g. "scorer", "enricher", "outreach") */
  slug: string;
  /** Override system prompt for this agent */
  prompt?: string;
  /** Model override */
  model?: string;
  /** Agent-specific config (tool allowlists, etc.) */
  config?: Record<string, unknown>;
}

export interface PipelineConfig {
  /** Scoring weights used by score.ts */
  scoring?: PipelineScoringWeights;
  /** Minimum score to pass (default: 50) */
  minScore?: number;
  /** Minimum confidence to pass (default: 40) */
  minConfidence?: number;
  /** Per-source settings */
  sources?: Record<string, PipelineSourceConfig>;
  /** Per-agent overrides */
  agents?: PipelineAgentConfig[];
  /** Version note (e.g. "tightened scoring thresholds") */
  versionNote?: string;
}

export interface ActivePipelineConfig {
  id: string;
  name: string;
  config: PipelineConfig;
  activatedAt: string | null;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  scoring: {
    baseScore: 25,
    freshnessHigh: 25,
    freshnessMedium: 12,
    warmPath: 18,
    contactAvailable: 10,
    strongRationale: 15,
    competitorComplaint: 20,
    lifecycleFit: 10,
    teamSizeFit: 8,
  },
  minScore: 50,
  minConfidence: 40,
  sources: {
    apollo: { enabled: true, confidence: 0.8 },
    phantombuster: { enabled: true, confidence: 0.7 },
    steam_bridge: { enabled: true, confidence: 0.6 },
    manual: { enabled: true, confidence: 0.9 },
  },
  agents: [],
};
