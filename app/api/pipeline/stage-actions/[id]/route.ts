import { NextRequest } from "next/server";
import { getTenantId } from "@/lib/tenant";
import { updateStageAction, deleteStageAction } from "@/lib/pipeline/stage-actions";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  fromStatus: z.string().optional(),
  toStatus: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  promptTemplate: z.string().min(1).optional(),
  autoApprove: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  updateStageAction(id, tenantId, parsed.data);
  return Response.json({ updated: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = getTenantId();

  deleteStageAction(id, tenantId);
  return Response.json({ deleted: true });
}
