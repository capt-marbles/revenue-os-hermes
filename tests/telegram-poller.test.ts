import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the telegram client
const mockGetUpdates = vi.fn();
const mockDeleteWebhook = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/telegram/client", () => ({
  getUpdates: (...args: unknown[]) => mockGetUpdates(...args),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
  deleteWebhook: () => mockDeleteWebhook(),
}));

vi.mock("@/lib/agents/copilot-chat-sync", () => ({
  copilotChatSync: vi.fn().mockResolvedValue("OK"),
  getOrCreateTelegramConversation: vi.fn().mockReturnValue("conv-1"),
}));

const mockDispatchMatchingTriggers = vi.fn();
vi.mock("@/lib/orchestration/trigger-router", () => ({
  dispatchMatchingTriggers: (...args: unknown[]) => mockDispatchMatchingTriggers(...args),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "tenant-1",
}));

describe("Telegram poller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("isPolling returns false initially", async () => {
    const { isPolling } = await import("@/lib/telegram/poller");
    expect(isPolling()).toBe(false);
  });

  it("stopPolling sets polling to false", async () => {
    const { stopPolling, isPolling } = await import("@/lib/telegram/poller");
    stopPolling();
    expect(isPolling()).toBe(false);
  });

  it("dispatches telegram triggers for inbound messages", async () => {
    const pollerModule = await import("@/lib/telegram/poller");
    const handleMessage = (pollerModule as unknown as {
      __testables__?: { handleMessage?: (update: unknown) => Promise<void> };
    }).__testables__?.handleMessage;

    expect(handleMessage).toBeDefined();

    await handleMessage?.({
      message: {
        message_id: 123,
        text: "urgent customer issue",
        chat: { id: 42, type: "private" },
      },
    });

    expect(mockDispatchMatchingTriggers).toHaveBeenCalledWith(
      "tenant-1",
      "telegram",
      expect.objectContaining({
        input: "urgent customer issue",
        source: "telegram",
      }),
    );
  });
});
