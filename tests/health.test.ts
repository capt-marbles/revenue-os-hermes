import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
const mockRun = vi.fn();
const mockSelectAll = vi.fn().mockReturnValue([]);
const mockUpdateRun = vi.fn();

vi.mock("@/db", () => ({
  db: {
    run: mockRun,
    select: () => ({
      from: () => ({
        where: () => ({
          all: mockSelectAll,
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ run: mockUpdateRun }),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  agentRuns: { id: "id", status: "status", startedAt: "started_at", agentId: "agent_id" },
  agents: { id: "id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...args: unknown[]) => args,
  lt: (a: unknown, b: unknown) => ({ a, b }),
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when DB is healthy and no stale runs", async () => {
    mockRun.mockReturnValue(undefined);
    mockSelectAll.mockReturnValue([]);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.staleRunsCleaned).toBe(0);
  });

  it("cleans up stale runs", async () => {
    mockRun.mockReturnValue(undefined);
    mockSelectAll.mockReturnValue([
      { id: "run-stale-1", agentId: "agent-1" },
      { id: "run-stale-2", agentId: "agent-2" },
    ]);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(body.staleRunsCleaned).toBe(2);
    // Should have called update for each stale run (run + agent = 2 calls per stale run)
    expect(mockUpdateRun).toHaveBeenCalledTimes(4);
  });

  it("returns 500 when DB is down", async () => {
    mockRun.mockImplementation(() => {
      throw new Error("SQLITE_CANTOPEN");
    });

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("error");
    expect(body.error).toContain("SQLITE_CANTOPEN");
  });
});
