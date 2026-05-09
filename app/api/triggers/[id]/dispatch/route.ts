import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { dispatchTriggerById } from "@/lib/orchestration/trigger-router";

const dispatchSchema = z.object({
  input: z.string().min(1),
  source: z.string().default("manual"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = dispatchSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = dispatchTriggerById(tenantId, id, parsed.data);

  if (!result.accepted) {
    return Response.json({ error: result.reason }, { status: 404 });
  }

  return Response.json({ runId: result.runId, triggerId: id }, { status: 202 });
}
