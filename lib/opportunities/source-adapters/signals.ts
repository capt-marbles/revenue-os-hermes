import type { OpportunityCandidate } from "@/lib/opportunities/candidate";

export interface SignalImportInput {
  id: string;
  sourceType?: "website" | "youtube" | "news" | "community" | "manual";
  signalType?: string | null;
  headline?: string | null;
  summary: string;
  url?: string | null;
  publishedAt?: string | null;
  freshness?: number | null;
  accountName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactLinkedin?: string | null;
  competitor?: string | null;
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

function inferFreshness(signal: SignalImportInput) {
  if (typeof signal.freshness === "number") {
    return clamp(signal.freshness);
  }

  if (!signal.publishedAt) {
    return 0.7;
  }

  const publishedAt = new Date(signal.publishedAt).getTime();
  if (Number.isNaN(publishedAt)) {
    return 0.7;
  }

  const ageHours = Math.max(0, (Date.now() - publishedAt) / (1000 * 60 * 60));
  if (ageHours <= 24) return 0.95;
  if (ageHours <= 72) return 0.85;
  if (ageHours <= 168) return 0.7;
  return 0.5;
}

function buildTitle(signal: SignalImportInput) {
  if (signal.accountName && signal.headline?.trim()) {
    return `${signal.accountName} · ${signal.headline.trim()}`;
  }
  if (signal.accountName && signal.contactName) {
    return `${signal.accountName} · ${signal.contactName}`;
  }
  if (signal.headline?.trim()) {
    return signal.headline.trim();
  }
  if (signal.accountName) {
    return signal.accountName;
  }
  return signal.id;
}

function buildSummary(signal: SignalImportInput) {
  const base = signal.summary.trim();
  const parts = [
    signal.competitor?.trim() ? `competitor: ${signal.competitor.trim()}` : null,
    signal.tags && signal.tags.length > 0 ? `tags: ${signal.tags.join(", ")}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? `${base} · ${parts.join(" · ")}` : base;
}

export function mapSignalToCandidate(signal: SignalImportInput): OpportunityCandidate {
  const hasWarmIntro =
    !!signal.warmIntro?.pathSummary?.trim() || !!signal.warmIntro?.mutualName?.trim();

  return {
    sourceType: signal.sourceType ?? "website",
    externalRef: signal.id,
    title: buildTitle(signal),
    accountName: signal.accountName?.trim() || null,
    contactName: signal.contactName?.trim() || null,
    contactEmail: signal.contactEmail?.trim().toLowerCase() || null,
    contactLinkedin: signal.contactLinkedin?.trim() || null,
    signalType: signal.signalType?.trim().toLowerCase() || "signal",
    summary: buildSummary(signal),
    freshness: inferFreshness(signal),
    suggestedPath: hasWarmIntro ? "warm" : "cold",
    rawPayloadRef: signal.url?.trim() || signal.id,
    sourceEvidence: {
      provider: signal.sourceType ?? "website",
      headline: signal.headline?.trim() || null,
      url: signal.url?.trim() || null,
      publishedAt: signal.publishedAt?.trim() || null,
      competitor: signal.competitor?.trim() || null,
      tags: signal.tags ?? [],
      connectorType: signal.warmIntro?.connectorType?.trim() || null,
      mutualName: signal.warmIntro?.mutualName?.trim() || null,
      mutualRef: signal.warmIntro?.mutualRef?.trim() || null,
      pathSummary: signal.warmIntro?.pathSummary?.trim() || null,
      introConfidence: signal.warmIntro?.confidence ?? null,
      introFreshness: signal.warmIntro?.freshness ?? null,
    },
  };
}
