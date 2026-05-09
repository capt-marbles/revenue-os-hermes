import { assembleCommandCenter } from "@/lib/command-center/assemble";
import { ensureDailyBriefingSnapshot } from "@/lib/command-center/briefing";

export async function GET() {
  ensureDailyBriefingSnapshot();
  const data = await assembleCommandCenter();
  return Response.json(data);
}
