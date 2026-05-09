import { startPolling, isPolling } from "@/lib/telegram/poller";
import { getMe } from "@/lib/telegram/client";

export async function POST() {

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ error: "TELEGRAM_BOT_TOKEN not set in .env.local" }, { status: 400 });
  }

  if (isPolling()) {
    return Response.json({ status: "already_running" });
  }

  // Verify bot token works
  const me = await getMe();
  if (!me) {
    return Response.json({ error: "Invalid bot token — could not connect to Telegram" }, { status: 400 });
  }

  // Start polling in background (non-blocking)
  startPolling();

  return Response.json({
    status: "started",
    bot: { username: me.username, name: me.first_name },
  });
}

export async function GET() {
  return Response.json({
    polling: isPolling(),
    configured: !!process.env.TELEGRAM_BOT_TOKEN,
  });
}
