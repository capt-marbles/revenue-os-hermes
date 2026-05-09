import { assembleBriefing } from "@/lib/agents/copilot-briefing";

export async function GET() {
  const briefing = await assembleBriefing();
  return Response.json(briefing);
}
