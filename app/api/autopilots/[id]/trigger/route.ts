import { NextRequest } from "next/server";
import { getTenantId } from "@/lib/tenant";
import { triggerAutopilot } from "@/lib/autopilots/runner";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = getTenantId();
  const { id } = await params;

  try {
    const runId = await triggerAutopilot(id, tenantId);
    return Response.json({ runId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Trigger failed" },
      { status: 500 }
    );
  }
}
