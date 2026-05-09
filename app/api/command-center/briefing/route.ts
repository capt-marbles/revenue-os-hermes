import { ensureDailyBriefingSnapshot, generateBriefingSnapshot } from "@/lib/command-center/briefing";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const snapshot = refresh ? generateBriefingSnapshot() : ensureDailyBriefingSnapshot();
  return Response.json(snapshot);
}
