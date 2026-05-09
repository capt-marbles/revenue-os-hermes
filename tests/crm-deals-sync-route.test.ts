import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSyncDealsWithTwenty = vi.fn();

vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "tenant-1",
}));

vi.mock("@/lib/crm/deal-sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crm/deal-sync")>("@/lib/crm/deal-sync");
  return {
    ...actual,
    syncDealsWithTwenty: (...args: unknown[]) => mockSyncDealsWithTwenty(...args),
  };
});

describe("POST /api/crm/deals/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs deals with Twenty using the requested direction", async () => {
    mockSyncDealsWithTwenty.mockResolvedValue({
      direction: "both",
      pull: { imported: 1, updated: 2, skipped: 0 },
      push: { synced: 3, created: 1, failed: 0, results: [] },
    });

    const { POST } = await import("@/app/api/crm/deals/sync/route");
    const response = await POST(
      new Request("http://localhost:3000/api/crm/deals/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "both", dealIds: ["deal-1", "deal-2"] }),
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.direction).toBe("both");
    expect(mockSyncDealsWithTwenty).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      direction: "both",
      dealIds: ["deal-1", "deal-2"],
    });
  });

  it("returns 503 when Twenty is not configured", async () => {
    const { TwentyConfigError } = await import("@/lib/crm/deal-sync");
    mockSyncDealsWithTwenty.mockRejectedValue(new TwentyConfigError("TWENTY_API_KEY not set"));

    const { POST } = await import("@/app/api/crm/deals/sync/route");
    const response = await POST(
      new Request("http://localhost:3000/api/crm/deals/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "pull" }),
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("TWENTY_API_KEY not set");
  });
});
