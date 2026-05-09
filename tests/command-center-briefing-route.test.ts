import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsureDailyBriefingSnapshot = vi.fn();
const mockGenerateBriefingSnapshot = vi.fn();

vi.mock("@/lib/command-center/briefing", () => ({
  ensureDailyBriefingSnapshot: (...args: unknown[]) => mockEnsureDailyBriefingSnapshot(...args),
  generateBriefingSnapshot: (...args: unknown[]) => mockGenerateBriefingSnapshot(...args),
}));

describe("GET /api/command-center/briefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDailyBriefingSnapshot.mockReturnValue({
      id: "brief-1",
      snapshotDate: "2026-04-09",
      status: "ready",
      summaryMarkdown: "## Morning Brief",
    });
    mockGenerateBriefingSnapshot.mockReturnValue({
      id: "brief-2",
      snapshotDate: "2026-04-09",
      status: "ready",
      summaryMarkdown: "## Morning Brief refreshed",
    });
  });

  it("returns the ensured daily snapshot by default", async () => {
    const { GET } = await import("@/app/api/command-center/briefing/route");
    const response = await GET(new Request("http://localhost:3000/api/command-center/briefing"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("brief-1");
    expect(mockEnsureDailyBriefingSnapshot).toHaveBeenCalledTimes(1);
  });

  it("forces a refresh when refresh=1 is passed", async () => {
    const { GET } = await import("@/app/api/command-center/briefing/route");
    const response = await GET(new Request("http://localhost:3000/api/command-center/briefing?refresh=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("brief-2");
    expect(mockGenerateBriefingSnapshot).toHaveBeenCalledTimes(1);
  });
});
