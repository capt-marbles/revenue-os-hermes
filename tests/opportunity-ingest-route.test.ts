import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIngestOpportunityCandidate = vi.fn();

vi.mock("@/lib/opportunities/ingest", () => ({
  ingestOpportunityCandidate: (...args: unknown[]) => mockIngestOpportunityCandidate(...args),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "tenant-1",
}));

describe("POST /api/opportunities/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ingests a single candidate", async () => {
    mockIngestOpportunityCandidate.mockReturnValue({
      opportunityId: "opp-1",
      created: true,
      dedupeReason: "created",
      status: "queued",
    });

    const { POST } = await import("@/app/api/opportunities/ingest/route");
    const request = new Request("http://localhost:3000/api/opportunities/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate: {
          sourceType: "apollo",
          externalRef: "apollo-1",
          accountName: "Game Studio Inc",
          contactEmail: "founder@example.com",
          summary: "High-fit Unreal studio displaced by competitor shutdown",
          freshness: 0.9,
          sourceEvidence: {},
          suggestedPath: "cold",
        },
      }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ingested).toBe(1);
    expect(body.created).toBe(1);
    expect(body.updated).toBe(0);
    expect(mockIngestOpportunityCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
      }),
    );
  });
});
