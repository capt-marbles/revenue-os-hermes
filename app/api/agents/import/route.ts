import { importAgents } from "@/lib/agents/importer";

export async function POST() {
  const result = await importAgents();
  return Response.json(result);
}
