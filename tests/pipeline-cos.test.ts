import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import Database from "better-sqlite3";

// ─── Scoring tests (pure functions, no DB) ─────────────────────────────────

describe("Config-Driven Scoring", () => {
  it("scores with default weights when no config provided", async () => {
    const { scoreOpportunityCandidate } = await import("@/lib/opportunities/score");

    const result = scoreOpportunityCandidate({
      sourceType: "apollo", externalRef: "test-1", title: "Test Studio",
      accountName: "Test Games", contactName: "Jane Doe", contactEmail: "jane@test.com",
      summary: "Multiplayer game studio with server pain", freshness: 0.9,
      suggestedPath: "warm", signalType: "multiplayer",
    });

    expect(result.baseScore).toBeGreaterThanOrEqual(50);
    expect(result.confidence).toBeGreaterThanOrEqual(50);
    expect(result.rationale).toContain("Fresh source evidence");
    expect(result.rationale).toContain("Warm intro path available");
  });

  it("respects higher minScore from pipeline config", async () => {
    const { scoreOpportunityCandidate, meetsThresholds } = await import("@/lib/opportunities/score");

    // Strong enough to pass default thresholds (minScore: 50, minConfidence: 40)
    const candidate = {
      sourceType: "manual", externalRef: "strong-1",
      title: "Strong Lead", summary: "Some lead", freshness: 0.8,
      contactEmail: "test@example.com", contactName: "Jane", accountName: "Studio",
    };

    const defaultResult = scoreOpportunityCandidate(candidate, null);
    expect(defaultResult.baseScore).toBeGreaterThanOrEqual(50);
    expect(meetsThresholds(defaultResult, null)).toBe(true);

    // Tight config rejects it
    expect(meetsThresholds(
      scoreOpportunityCandidate(candidate, { minScore: 90 }),
      { minScore: 90 },
    )).toBe(false);
  });

  it("adjusts score for low-confidence sources", async () => {
    const { scoreOpportunityCandidate } = await import("@/lib/opportunities/score");

    const candidate = {
      sourceType: "unverified_source", externalRef: "unv-1", title: "Unverified",
      contactEmail: "test@unverified.com", summary: "Lead from low-trust source", freshness: 0.9,
    };

    const defaultResult = scoreOpportunityCandidate(candidate, null);
    const adjustedResult = scoreOpportunityCandidate(candidate, {
      sources: { unverified_source: { enabled: true, confidence: 0.3 } },
    });

    expect(adjustedResult.baseScore).toBeLessThan(defaultResult.baseScore);
    expect(adjustedResult.rationale.some((r: string) => r.includes("Source confidence adjusted"))).toBe(true);
  });

  it("tags result with pipelineConfigId for attribution", async () => {
    const { scoreOpportunityCandidate } = await import("@/lib/opportunities/score");

    const result = scoreOpportunityCandidate(
      { sourceType: "apollo", externalRef: "attr-1", summary: "test", freshness: 0.8 },
      null, "config_abc123",
    );

    expect(result.pipelineConfigId).toBe("config_abc123");
  });

  it("baseline weights are consistent and deterministic", async () => {
    const { scoreOpportunityCandidate } = await import("@/lib/opportunities/score");

    // Run twice with same input → same output
    const candidate = {
      sourceType: "apollo", externalRef: "baseline-1", title: "Baseline Studio",
      accountName: "Baseline Games", contactName: "John Smith",
      contactEmail: "john@baseline.com", summary: "Test", freshness: 0.85,
      suggestedPath: "warm" as const,
    };

    const r1 = scoreOpportunityCandidate(candidate, null);
    const r2 = scoreOpportunityCandidate(candidate, null);
    expect(r1.baseScore).toBe(r2.baseScore);
    expect(r1.confidence).toBe(r2.confidence);

    // Should score highly — has all positive signals
    expect(r1.baseScore).toBeGreaterThanOrEqual(75);
    expect(r1.rationale.length).toBeGreaterThanOrEqual(4);
  });
});
