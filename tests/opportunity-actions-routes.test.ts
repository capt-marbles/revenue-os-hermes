import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectOpportunityPath = vi.fn();
const mockCreateOpportunityDraft = vi.fn();
const mockCreateOpportunitySyncEvent = vi.fn();
const mockSyncOpportunityToTwenty = vi.fn();

vi.mock("@/lib/opportunities/actions", () => ({
  selectOpportunityPath: (...args: unknown[]) => mockSelectOpportunityPath(...args),
  createOpportunityDraft: (...args: unknown[]) => mockCreateOpportunityDraft(...args),
  createOpportunitySyncEvent: (...args: unknown[]) => mockCreateOpportunitySyncEvent(...args),
}));

vi.mock("@/lib/opportunities/sync", () => ({
  syncOpportunityToTwenty: (...args: unknown[]) => mockSyncOpportunityToTwenty(...args),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "tenant-1",
}));

describe("Opportunity action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects an opportunity path", async () => {
    mockSelectOpportunityPath.mockReturnValue({
      opportunityId: "opp-1",
      primaryPath: "warm",
      status: "intro_candidate",
    });

    const { POST } = await import("@/app/api/opportunities/[id]/path-select/route");
    const response = await POST(
      new Request("http://localhost:3000/api/opportunities/opp-1/path-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "warm" }),
      }) as never,
      { params: Promise.resolve({ id: "opp-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.primaryPath).toBe("warm");
    expect(mockSelectOpportunityPath).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      opportunityId: "opp-1",
      path: "warm",
    });
  });

  it("creates an opportunity draft", async () => {
    mockCreateOpportunityDraft.mockResolvedValue({
      draftId: "draft-1",
      opportunityId: "opp-1",
      draftType: "cold_email",
      status: "generated",
      approvalMode: "pending",
      subject: "Subject",
      content: "Body",
      modelRef: "claude:sonnet",
    });

    const { POST } = await import("@/app/api/opportunities/[id]/draft/route");
    const response = await POST(
      new Request("http://localhost:3000/api/opportunities/opp-1/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftType: "cold_email", approvalMode: "pending" }),
      }) as never,
      { params: Promise.resolve({ id: "opp-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.draftId).toBe("draft-1");
    expect(mockCreateOpportunityDraft).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      opportunityId: "opp-1",
      draftType: "cold_email",
      approvalMode: "pending",
    });
  });

  it("writes an opportunity sync event", async () => {
    mockSyncOpportunityToTwenty.mockResolvedValue({
      syncId: "sync-1",
      opportunityId: "opp-1",
      targetSystem: "twenty",
      actionType: "create_contact",
      status: "success",
    });

    const { POST } = await import("@/app/api/opportunities/[id]/sync/route");
    const response = await POST(
      new Request("http://localhost:3000/api/opportunities/opp-1/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetSystem: "twenty",
          actionType: "create_contact",
          payloadSummary: "Synced from Command Center operator action",
        }),
      }) as never,
      { params: Promise.resolve({ id: "opp-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.syncId).toBe("sync-1");
    expect(mockSyncOpportunityToTwenty).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      opportunityId: "opp-1",
      actionType: "create_contact",
      payloadSummary: "Synced from Command Center operator action",
    });
  });
});
