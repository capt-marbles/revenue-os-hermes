import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDispatchMatchingTriggers = vi.fn();
const mockGetOrCreateSystemConversation = vi.fn((..._args: unknown[]) => "conv-webhook-1");
const mockCopilotChatSync = vi.fn();
const mockIngestOpportunityCandidate = vi.fn();

vi.mock("@/lib/orchestration/trigger-router", () => ({
  dispatchMatchingTriggers: (...args: unknown[]) => mockDispatchMatchingTriggers(...args),
}));

vi.mock("@/lib/agents/copilot-chat-sync", () => ({
  getOrCreateSystemConversation: (...args: unknown[]) => mockGetOrCreateSystemConversation(...args),
  copilotChatSync: (...args: unknown[]) => mockCopilotChatSync(...args),
}));

vi.mock("@/lib/opportunities/ingest", () => ({
  ingestOpportunityCandidate: (...args: unknown[]) => mockIngestOpportunityCandidate(...args),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "tenant-1",
}));

describe("POST /api/events/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCopilotChatSync.mockResolvedValue("Recommended Action");
    mockIngestOpportunityCandidate.mockReturnValue({
      opportunityId: "opp-1",
      created: true,
      dedupeReason: "created",
      status: "queued",
    });
  });

  it("dispatches matching webhook triggers", async () => {
    mockDispatchMatchingTriggers.mockReturnValue({
      triggered: [{ id: "trigger-1", name: "CRM webhook", runId: "run-1" }],
      skipped: [],
    });

    const { POST } = await import("@/app/api/events/webhook/route");
    const request = new Request("http://localhost:3000/api/events/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "crm.high_value_deal_updated",
        input: "Deal ACME moved to proposal",
        metadata: { externalEventId: "evt-123" },
      }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockDispatchMatchingTriggers).toHaveBeenCalledWith(
      "tenant-1",
      "webhook",
      expect.objectContaining({
        input: "Deal ACME moved to proposal",
        source: "webhook",
      }),
    );
    expect(body.accepted).toBe(true);
    expect(body.conversationId).toBe("conv-webhook-1");
    expect(body.triggered).toHaveLength(1);
    expect(mockCopilotChatSync).toHaveBeenCalled();
  });

  it("ingests attached opportunity candidates from webhook metadata", async () => {
    mockDispatchMatchingTriggers.mockReturnValue({
      triggered: [],
      skipped: [],
    });

    const { POST } = await import("@/app/api/events/webhook/route");
    const request = new Request("http://localhost:3000/api/events/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "signal.competitor_shutdown",
        input: "Hathora shutdown signal observed",
        metadata: {
          opportunityCandidate: {
            sourceType: "website",
            externalRef: "signal-1",
            accountName: "Acme Games",
            contactEmail: "founder@acme.games",
            summary: "Prospect appears displaced by platform shutdown",
            freshness: 0.95,
            suggestedPath: "warm",
            sourceEvidence: {
              connectorType: "linkedin",
              pathSummary: "You know Sarah, Sarah knows the founder.",
              mutualName: "Sarah",
            },
          },
        },
      }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ingested).toHaveLength(1);
    expect(mockIngestOpportunityCandidate).toHaveBeenCalledTimes(1);
  });
});
