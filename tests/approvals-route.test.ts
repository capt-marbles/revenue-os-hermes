import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockResolveApproval = vi.fn();
const mockRevertApproval = vi.fn();
const mockResolveViaHermes = vi.fn();
const mockGetProfileForDesk = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: () => null,
}));

vi.mock("@/lib/approval-store", () => ({
  resolveApproval: (...args: unknown[]) => mockResolveApproval(...args),
  revertApproval: (...args: unknown[]) => mockRevertApproval(...args),
  resolveViaHermes: (...args: unknown[]) => mockResolveViaHermes(...args),
  getProfileForDesk: (...args: unknown[]) => mockGetProfileForDesk(...args),
}));

describe("PATCH /api/approvals/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reverts the local approval when Hermes resolution fails", async () => {
    mockResolveApproval.mockReturnValue({
      id: "apr-1",
      deskId: "scout",
      sessionKey: "session-1",
      status: "approved",
    });
    mockGetProfileForDesk.mockReturnValue("scout");
    mockResolveViaHermes.mockResolvedValue(false);

    const { PATCH } = await import("@/app/api/approvals/[id]/route");
    const request = new NextRequest("http://localhost:3000/api/approvals/apr-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "once" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "apr-1" }) });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toContain("Failed to resolve approval");
    expect(mockRevertApproval).toHaveBeenCalledWith("apr-1");
  });

  it("returns the resolved approval when Hermes succeeds", async () => {
    const approval = {
      id: "apr-2",
      deskId: "outreach",
      sessionKey: "session-2",
      status: "approved",
    };

    mockResolveApproval.mockReturnValue(approval);
    mockGetProfileForDesk.mockReturnValue("outreach");
    mockResolveViaHermes.mockResolvedValue(true);

    const { PATCH } = await import("@/app/api/approvals/[id]/route");
    const request = new NextRequest("http://localhost:3000/api/approvals/apr-2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "always" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "apr-2" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.approval).toEqual(approval);
    expect(body.hermesResolved).toBe(true);
    expect(mockRevertApproval).not.toHaveBeenCalled();
  });
});
