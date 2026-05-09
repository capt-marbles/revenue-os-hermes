import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { createOpportunityDraft } from "@/lib/opportunities/actions";

const schema = z.object({
  draftType: z.enum(["cold_email", "intro_request", "follow_up"]).optional(),
  approvalMode: z.enum(["auto", "pending"]).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const tenantId = getTenantId();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await createOpportunityDraft({
      tenantId,
      opportunityId: id,
      draftType: parsed.data.draftType,
      approvalMode: parsed.data.approvalMode,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "OPPORTUNITY_NOT_FOUND") {
      return Response.json({ error: "Opportunity not found" }, { status: 404 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create draft" },
      { status: 500 },
    );
  }
}
