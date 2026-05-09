import type { OpportunityCandidate } from "@/lib/opportunities/candidate";

export interface HunterLeadInput {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  position?: string | null;
  company?: string | null;
  domain?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  confidence?: number | null; // Hunter email confidence 0-100
  department?: string | null;
  seniority?: string | null;
  phoneNumbers?: Array<{
    number?: string | null;
    type?: string | null;
    confidence?: number | null;
  }> | null;
  verificationStatus?: string | null; // "risky" | "valid" | "unverified"
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function displayName(lead: HunterLeadInput): string | null {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return fullName || null;
}

function buildSummary(lead: HunterLeadInput): string {
  const parts = [
    lead.position?.trim(),
    lead.company?.trim(),
    lead.department?.trim() ? `dept: ${lead.department.trim()}` : null,
    lead.seniority?.trim() ? `level: ${lead.seniority.trim()}` : null,
  ].filter(Boolean);

  return parts.length > 0
    ? `Hunter prospect ${parts.join(" · ")}`
    : "Hunter prospect imported for outbound review";
}

/**
 * Map Hunter email confidence (0-100) to freshness (0-1).
 * Confidence 90+ = fresh, 50-89 = moderate, <50 = stale.
 */
function mapConfidence(confidence: number | null | undefined): number {
  if (confidence === null) return 0.7;
  return clamp((confidence ?? 0) / 100);
}

/**
 * Determine suggested outreach path based on verification status and confidence.
 */
function suggestPath(lead: HunterLeadInput): "warm" | "cold" | "none" {
  if (!lead.email) return "none";
  if (lead.verificationStatus === "valid") return "cold";
  if (lead.verificationStatus === "risky") return "cold"; // still usable but flag it
  if ((lead.confidence ?? 0) >= 80) return "cold";
  return "none"; // low confidence = don't suggest email path
}

export function mapHunterLeadToCandidate(lead: HunterLeadInput): OpportunityCandidate {
  const contactName = displayName(lead);

  return {
    sourceType: "hunter",
    externalRef: lead.id,
    title: contactName && lead.company
      ? `${lead.company} · ${contactName}`
      : lead.company || contactName || lead.id,
    accountName: lead.company?.trim() || null,
    contactName,
    contactEmail: lead.email?.trim().toLowerCase() || null,
    contactLinkedin: lead.linkedin?.trim() || null,
    signalType: null, // Hunter doesn't have signal data natively
    summary: buildSummary(lead),
    freshness: mapConfidence(lead.confidence),
    suggestedPath: suggestPath(lead),
    rawPayloadRef: lead.id,
    sourceEvidence: {
      provider: "hunter",
      position: lead.position?.trim() || null,
      domain: lead.domain?.trim() || null,
      linkedin: lead.linkedin?.trim() || null,
      twitter: lead.twitter?.trim() || null,
      confidence: lead.confidence ?? null,
      verificationStatus: lead.verificationStatus?.trim() || null,
      department: lead.department?.trim() || null,
      seniority: lead.seniority?.trim() || null,
      phoneNumbers: lead.phoneNumbers ?? null,
    },
  };
}
