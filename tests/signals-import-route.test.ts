import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIngestOpportunityCandidate = vi.fn();

vi.mock("@/lib/opportunities/ingest", () => ({
  ingestOpportunityCandidate: (...args: unknown[]) => mockIngestOpportunityCandidate(...args),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "tenant-1",
}));

describe("POST /api/sources/signals/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps monitored signals and imports them through shared opportunity ingest", async () => {
    mockIngestOpportunityCandidate
      .mockReturnValueOnce({
        opportunityId: "opp-signal-1",
        created: true,
        dedupeReason: "created",
        status: "queued",
      })
      .mockReturnValueOnce({
        opportunityId: "opp-signal-2",
        created: true,
        dedupeReason: "created",
        status: "queued",
      });

    const { POST } = await import("@/app/api/sources/signals/import/route");
    const request = new Request("http://localhost:3000/api/sources/signals/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signals: [
          {
            id: "signal-1",
            sourceType: "website",
            signalType: "signal",
            headline: "Hathora shuts down hosted multiplayer platform",
            summary: "Studios using Hathora need a replacement and migration path.",
            url: "https://example.com/hathora-shutdown",
            competitor: "Hathora",
            accountName: "Acme Games",
            contactEmail: "founder@acme.games",
            tags: ["competitor", "shutdown", "migration"],
          },
          {
            id: "signal-2",
            sourceType: "youtube",
            summary: "Multiplay developers discussing migration pain on YouTube.",
            url: "https://youtube.com/watch?v=abc123",
            competitor: "Multiplay",
            accountName: "Beta Studio",
            contactName: "Jess Park",
            warmIntro: {
              mutualName: "Sarah",
              pathSummary: "Sarah invested in Beta Studio and can introduce Jess.",
              confidence: 84,
              freshness: 88,
              connectorType: "linkedin",
            },
          },
        ],
      }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.imported).toBe(2);
    expect(body.created).toBe(2);
    expect(mockIngestOpportunityCandidate).toHaveBeenCalledTimes(2);
    expect(mockIngestOpportunityCandidate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenantId: "tenant-1",
        candidate: expect.objectContaining({
          sourceType: "website",
          signalType: "signal",
          accountName: "Acme Games",
        }),
      }),
    );
    expect(mockIngestOpportunityCandidate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        candidate: expect.objectContaining({
          sourceType: "youtube",
          suggestedPath: "warm",
          sourceEvidence: expect.objectContaining({
            competitor: "Multiplay",
            mutualName: "Sarah",
          }),
        }),
      }),
    );
  });
});
