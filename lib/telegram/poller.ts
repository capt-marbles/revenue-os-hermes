import { getUpdates, sendMessage, sendChatAction, deleteWebhook, type TelegramUpdate } from "./client";
import { handleCommand } from "./commands";
import { copilotChatSync, getOrCreateTelegramConversation } from "@/lib/agents/copilot-chat-sync";
import { getTenantId } from "@/lib/tenant";
import { dispatchMatchingTriggers } from "@/lib/orchestration/trigger-router";

let polling = false;
let lastOffset: number | undefined;
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60000; // 1 minute max

export function isPolling(): boolean {
  return polling;
}

export async function startPolling(): Promise<void> {
  if (polling) return;

  // Clear any existing webhook so getUpdates works
  await deleteWebhook();

  polling = true;
  consecutiveErrors = 0;
  console.log(JSON.stringify({ event: "telegram_polling_started", timestamp: new Date().toISOString() }));

  while (polling) {
    try {
      const updates = await getUpdates(lastOffset);
      consecutiveErrors = 0; // Reset on success

      for (const update of updates) {
        lastOffset = update.update_id + 1;

        if (update.message?.text) {
          handleMessage(update).catch((err) => {
            console.error("[Telegram] Error handling message:", err);
          });
        }
      }
    } catch (err) {
      consecutiveErrors++;
      const backoffMs = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), MAX_BACKOFF_MS);
      console.error(JSON.stringify({
        event: "telegram_polling_error",
        error: err instanceof Error ? err.message : String(err),
        consecutiveErrors,
        backoffMs,
        timestamp: new Date().toISOString(),
      }));
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  console.log(JSON.stringify({ event: "telegram_polling_stopped", timestamp: new Date().toISOString() }));
}

export function stopPolling(): void {
  polling = false;
}

async function handleMessage(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text || !message.chat) return;

  const tenantId = getTenantId();
  const chatId = message.chat.id;
  const text = message.text.trim();

  // Check if it's a command
  if (text.startsWith("/")) {
    const spaceIdx = text.indexOf(" ");
    const command = spaceIdx > 0 ? text.slice(0, spaceIdx) : text;
    const args = spaceIdx > 0 ? text.slice(spaceIdx + 1) : "";

    // Strip @botname from command (e.g., /status@mybot)
    const cleanCommand = command.split("@")[0].toLowerCase();

    dispatchMatchingTriggers(tenantId, "telegram", {
      input: text,
      source: "telegram",
      metadata: {
        chatId,
        chatType: message.chat.type,
        messageId: message.message_id,
        isCommand: true,
        command: cleanCommand,
      },
    });

    const response = await handleCommand(cleanCommand, args);
    await sendMessage(chatId, response);
    return;
  }

  dispatchMatchingTriggers(tenantId, "telegram", {
    input: text,
    source: "telegram",
    metadata: {
      chatId,
      chatType: message.chat.type,
      messageId: message.message_id,
      isCommand: false,
    },
  });

  // Plain text — chat with Chief of Staff
  await sendChatAction(chatId, "typing");

  const conversationId = getOrCreateTelegramConversation(chatId);
  const response = await copilotChatSync(conversationId, text);

  await sendMessage(chatId, response);
}

export const __testables__ = {
  handleMessage,
};
