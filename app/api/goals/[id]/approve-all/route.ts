import { NextRequest } from "next/server";
import { getTenantId } from "@/lib/tenant";
import { approveAllForGoal } from "@/lib/agents/task-engine";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const approved = await approveAllForGoal(id, tenantId);

  return Response.json({ approved });
}
