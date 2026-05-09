import type { OpportunityCandidate } from "@/lib/opportunities/candidate";

export interface ApolloLeadInput {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyLinkedinUrl?: string | null;
  summary?: string | null;
  signalType?: string | null;
  freshness?: number | null;
  tags?: string[];
  warmIntro?: {
    mutualName?: string | null;
    mutualRef?: string | null;
    pathSummary?: string | null;
    confidence?: number | null;
    freshness?: number | null;
    connectorType?: string | null;
  } | null;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function displayName(lead: ApolloLeadInput) {
  if (lead.name?.trim()) return lead.name.trim();
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return fullName || null;
}

function buildSummary(lead: ApolloLeadInput) {
  if (lead.summary?.trim()) return lead.summary.trim();

  const parts = [
    lead.title?.trim(),
    lead.companyName?.trim(),
    lead.tags && lead.tags.length > 0 ? `tags: ${lead.tags.join(", ")}` : null,
  ].filter(Boolean);

  return parts.length > 0
    ? `Apollo prospect ${parts.join(" · ")}`
    : "Apollo prospect imported for outbound review";
}

export function mapApolloLeadToCandidate(lead: ApolloLeadInput): OpportunityCandidate {
  const contactName = displayName(lead);
  const hasWarmIntro =
    !!lead.warmIntro?.pathSummary?.trim() || !!lead.warmIntro?.mutualName?.trim();

  return {
    sourceType: "apollo",
    externalRef: lead.id,
    title: contactName && lead.companyName
      ? `${lead.companyName} · ${contactName}`
      : lead.companyName || contactName || lead.id,
    accountName: lead.companyName?.trim() || null,
    contactName,
    contactEmail: lead.email?.trim().toLowerCase() || null,
    contactLinkedin: lead.linkedinUrl?.trim() || null,
    signalType: lead.signalType?.trim().toLowerCase() || null,
    summary: buildSummary(lead),
    freshness: clamp(lead.freshness ?? 0.85),
    suggestedPath: hasWarmIntro ? "warm" : "cold",
    rawPayloadRef: lead.id,
    sourceEvidence: {
      provider: "apollo",
      title: lead.title?.trim() || null,
      companyDomain: lead.companyDomain?.trim() || null,
      companyLinkedinUrl: lead.companyLinkedinUrl?.trim() || null,
      tags: lead.tags ?? [],
      connectorType: lead.warmIntro?.connectorType?.trim() || null,
      mutualName: lead.warmIntro?.mutualName?.trim() || null,
      mutualRef: lead.warmIntro?.mutualRef?.trim() || null,
      pathSummary: lead.warmIntro?.pathSummary?.trim() || null,
      introConfidence: lead.warmIntro?.confidence ?? null,
      introFreshness: lead.warmIntro?.freshness ?? null,
    },
  };
}
