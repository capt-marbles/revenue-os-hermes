export interface OpportunityCandidate {
  sourceType: string;
  externalRef: string;
  title?: string | null;
  accountName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactLinkedin?: string | null;
  signalType?: string | null;
  summary: string;
  freshness: number;
  sourceEvidence?: Record<string, unknown>;
  suggestedPath?: "cold" | "warm" | "none";
  rawPayloadRef?: string | null;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeOpportunityCandidate(
  candidate: OpportunityCandidate,
): OpportunityCandidate {
  return {
    ...candidate,
    sourceType: candidate.sourceType.trim().toLowerCase(),
    externalRef: candidate.externalRef.trim(),
    title: candidate.title?.trim() || null,
    accountName: candidate.accountName?.trim() || null,
    contactName: candidate.contactName?.trim() || null,
    contactEmail: candidate.contactEmail?.trim().toLowerCase() || null,
    contactLinkedin: candidate.contactLinkedin?.trim() || null,
    signalType: candidate.signalType?.trim().toLowerCase() || null,
    summary: candidate.summary.trim(),
    freshness: clamp(candidate.freshness),
    suggestedPath: candidate.suggestedPath ?? "none",
    rawPayloadRef: candidate.rawPayloadRef?.trim() || null,
    sourceEvidence: candidate.sourceEvidence ?? {},
  };
}
