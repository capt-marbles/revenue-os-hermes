import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { selectOpportunityPath } from "@/lib/opportunities/actions";

const schema = z.object({
  path: z.enum(["cold", "warm"]),
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
    const result = selectOpportunityPath({
      tenantId,
      opportunityId: id,
      path: parsed.data.path,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "OPPORTUNITY_NOT_FOUND") {
      return Response.json({ error: "Opportunity not found" }, { status: 404 });
    }

    return Response.json({ error: "Failed to select path" }, { status: 500 });
  }
}
