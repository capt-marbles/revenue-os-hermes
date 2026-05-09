const TELEGRAM_API = "https://api.telegram.org";

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return token;
}

function apiUrl(method: string): string {
  return `${TELEGRAM_API}/bot${getToken()}/${method}`;
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  options?: { parseMode?: "MarkdownV2" | "HTML"; replyToMessageId?: number }
): Promise<void> {
  // Telegram has a 4096 char limit — split if needed
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
    };
    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.replyToMessageId) body.reply_to_message_id = options.replyToMessageId;

    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // If MarkdownV2 fails, retry without formatting
      if (options?.parseMode) {
        await fetch(apiUrl("sendMessage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });
      }
    }
  }
}

export async function sendChatAction(chatId: number | string, action: string = "typing"): Promise<void> {
  await fetch(apiUrl("sendChatAction"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; first_name?: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    date: number;
  };
}

export async function getUpdates(offset?: number): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams({ timeout: "30" });
  if (offset !== undefined) params.set("offset", String(offset));

  const res = await fetch(`${apiUrl("getUpdates")}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  return data.result ?? [];
}

export async function getMe(): Promise<{ id: number; first_name: string; username: string } | null> {
  const res = await fetch(apiUrl("getMe"));
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
}

// Delete any existing webhook so polling works
export async function deleteWebhook(): Promise<void> {
  await fetch(apiUrl("deleteWebhook"), { method: "POST" });
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen * 0.5) {
      // No good newline — split at space
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      // No good split point — hard cut
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
