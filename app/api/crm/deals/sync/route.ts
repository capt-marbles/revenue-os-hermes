import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { syncDealsWithTwenty, TwentyConfigError } from "@/lib/crm/deal-sync";

const schema = z.object({
  direction: z.enum(["pull", "push", "both"]).optional(),
  dealIds: z.array(z.string()).min(1).optional(),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await syncDealsWithTwenty({
      tenantId,
      direction: parsed.data.direction,
      dealIds: parsed.data.dealIds,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof TwentyConfigError || (error instanceof Error && error.message === "TWENTY_API_KEY not set")) {
      return Response.json({ error: "TWENTY_API_KEY not set" }, { status: 503 });
    }

    if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Twenty sync failed",
          details: "details" in error && typeof error.details === "string" ? error.details : undefined,
        },
        { status: error.status },
      );
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to sync CRM deals" },
      { status: 500 },
    );
  }
}
