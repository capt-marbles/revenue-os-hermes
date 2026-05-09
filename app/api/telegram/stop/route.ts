import { stopPolling } from "@/lib/telegram/poller";

export async function POST() {
  stopPolling();
  return Response.json({ status: "stopped" });
}
