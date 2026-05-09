export const ACTIVE_PIPELINE_STAGES = [
  "target_account",
  "reachout",
  "connected",
  "technical_evaluation",
  "quote_issued",
  "committed",
  "contract_signed",
  "live",
] as const;

export const EXIT_PIPELINE_STAGES = ["lost"] as const;

export const LOCAL_DEAL_STAGES = [
  ...ACTIVE_PIPELINE_STAGES,
  ...EXIT_PIPELINE_STAGES,
] as const;

export type LocalDealStage = (typeof LOCAL_DEAL_STAGES)[number];

export const STAGE_LABELS: Record<LocalDealStage, string> = {
  target_account: "Target Account",
  reachout: "Reachout",
  connected: "Connected",
  technical_evaluation: "Technical Evaluation",
  quote_issued: "Quote Issued",
  committed: "Committed",
  contract_signed: "Contract Signed",
  live: "Live",
  lost: "Lost",
};

export const STAGE_SUBTITLES: Record<(typeof ACTIVE_PIPELINE_STAGES)[number], string> = {
  target_account: "Sourced prospect, not yet contacted",
  reachout: "First outbound contact attempted",
  connected: "Prospect replied or conversation started",
  technical_evaluation: "Hands-on validation and solution testing",
  quote_issued: "Commercial terms or quote is out",
  committed: "Commercially committed, contract in progress",
  contract_signed: "Signed and ready for handoff",
  live: "Active customer generating revenue",
};

const LEGACY_TO_LOCAL_STAGE: Record<string, LocalDealStage> = {
  target_account: "target_account",
  nurture: "target_account",
  discovery: "reachout",
  technical_eval: "technical_evaluation",
  proposal: "quote_issued",
  negotiation: "quote_issued",
  won: "contract_signed",
  lost: "lost",
  connected: "connected",
  committed: "committed",
  reachout: "reachout",
  technical_evaluation: "technical_evaluation",
  quote_issued: "quote_issued",
  contract_signed: "contract_signed",
  live: "live",
};

export function normalizeLocalDealStage(stage?: string | null): LocalDealStage | null {
  if (!stage) return null;
  return LEGACY_TO_LOCAL_STAGE[stage] ?? null;
}

