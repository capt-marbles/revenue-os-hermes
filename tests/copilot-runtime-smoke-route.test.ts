import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockExecute = vi.fn();
const mockGetRuntimeById = vi.fn();
const mockGetRuntime = vi.fn();
const mockRequireAuth = vi.fn();
const mockResolveChiefOfStaffRuntime = vi.fn();
const mockGetChiefOfStaffCodexSandboxMode = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock("@/lib/runtime", () => ({
  getRuntime: () => mockGetRuntime(),
  getRuntimeById: (...args: unknown[]) => mockGetRuntimeById(...args),
}));

vi.mock("@/lib/copilot/runtime-selection", () => ({
  resolveChiefOfStaffRuntime: (...args: unknown[]) => mockResolveChiefOfStaffRuntime(...args),
  getChiefOfStaffCodexSandboxMode: () => mockGetChiefOfStaffCodexSandboxMode(),
}));

describe("POST /api/copilot/runtime-smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(null);
    mockResolveChiefOfStaffRuntime.mockReturnValue({
      runtimeId: "codex",
      model: "gpt-5.4",
    });
    mockGetChiefOfStaffCodexSandboxMode.mockReturnValue("read-only");
    mockGetRuntimeById.mockReturnValue({
      id: "codex",
      execute: mockExecute,
    });
    mockGetRuntime.mockReturnValue({
      id: "claude",
      execute: mockExecute,
    });
  });

  it("runs the selected runtime and returns the result payload", async () => {
    mockExecute.mockResolvedValue({
      stdout: "OK",
      stderr: "",
      exitCode: 0,
    });

    const { POST } = await import("@/app/api/copilot/runtime-smoke/route");
    const request = new NextRequest("http://localhost:3000/api/copilot/runtime-smoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.runtimeId).toBe("codex");
    expect(mockExecute).toHaveBeenCalledWith("Reply with exactly OK.", {
      model: "gpt-5.4",
      timeout: 120000,
      sandboxMode: "read-only",
    });
  });

  it("returns auth response when blocked", async () => {
    mockRequireAuth.mockReturnValue(
      Response.json({ error: "blocked" }, { status: 401 }),
    );

    const { POST } = await import("@/app/api/copilot/runtime-smoke/route");
    const request = new NextRequest("http://localhost:3000/api/copilot/runtime-smoke", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
