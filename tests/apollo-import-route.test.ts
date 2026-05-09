import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIngestOpportunityCandidate = vi.fn();

vi.mock("@/lib/opportunities/ingest", () => ({
  ingestOpportunityCandidate: (...args: unknown[]) => mockIngestOpportunityCandidate(...args),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "tenant-1",
}));

describe("POST /api/sources/apollo/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps Apollo leads and imports them through shared opportunity ingest", async () => {
    mockIngestOpportunityCandidate
      .mockReturnValueOnce({
        opportunityId: "opp-1",
        created: true,
        dedupeReason: "created",
        status: "queued",
      })
      .mockReturnValueOnce({
        opportunityId: "opp-2",
        created: false,
        dedupeReason: "email",
        status: "scored",
      });

    const { POST } = await import("@/app/api/sources/apollo/import/route");
    const request = new Request("http://localhost:3000/api/sources/apollo/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leads: [
          {
            id: "apollo-1",
            firstName: "Alex",
            lastName: "Rivera",
            title: "Founder",
            email: "alex@studio.dev",
            linkedinUrl: "https://linkedin.com/in/alex",
            companyName: "Studio Dev",
            summary: "Hathora customer at risk after shutdown announcement",
            freshness: 0.92,
            tags: ["hathora", "unreal"],
          },
          {
            id: "apollo-2",
            name: "Sam Lee",
            companyName: "Multiplayer Works",
            email: "sam@mpworks.com",
            title: "CTO",
            warmIntro: {
              mutualName: "Sarah",
              pathSummary: "Sarah worked with Sam at a prior studio.",
              confidence: 88,
              freshness: 91,
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
    expect(body.created).toBe(1);
    expect(body.updated).toBe(1);
    expect(mockIngestOpportunityCandidate).toHaveBeenCalledTimes(2);
    expect(mockIngestOpportunityCandidate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenantId: "tenant-1",
        candidate: expect.objectContaining({
          sourceType: "apollo",
          externalRef: "apollo-1",
          contactEmail: "alex@studio.dev",
          suggestedPath: "cold",
        }),
      }),
    );
    expect(mockIngestOpportunityCandidate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        candidate: expect.objectContaining({
          suggestedPath: "warm",
          sourceEvidence: expect.objectContaining({
            mutualName: "Sarah",
            connectorType: "linkedin",
          }),
        }),
      }),
    );
  });
});
