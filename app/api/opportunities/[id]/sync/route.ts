import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { createOpportunitySyncEvent } from "@/lib/opportunities/actions";
import {
  syncOpportunityToTwenty,
  syncOpportunityStageToTwenty,
} from "@/lib/opportunities/sync";

const schema = z.object({
  targetSystem: z.enum(["twenty", "gmail", "tasks"]),
  actionType: z.enum(["create_contact", "update_contact", "create_note", "create_draft", "update_stage"]),
  stage: z.string().optional(),
  externalRef: z.string().optional(),
  payloadSummary: z.string().optional(),
  status: z.enum(["pending", "success", "conflict", "failed"]).optional(),
  errorClass: z.string().optional(),
  errorMessage: z.string().optional(),
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
    const result =
      parsed.data.targetSystem === "twenty" && parsed.data.actionType === "update_stage"
        ? await syncOpportunityStageToTwenty({
            tenantId,
            opportunityId: id,
            stage: parsed.data.stage ?? "",
            payloadSummary: parsed.data.payloadSummary,
          })
        : parsed.data.targetSystem === "twenty" &&
            (parsed.data.actionType === "create_contact" ||
              parsed.data.actionType === "update_contact")
          ? await syncOpportunityToTwenty({
              tenantId,
              opportunityId: id,
              actionType: parsed.data.actionType,
              payloadSummary: parsed.data.payloadSummary,
            })
          : createOpportunitySyncEvent({
            tenantId,
            opportunityId: id,
            targetSystem: parsed.data.targetSystem,
            actionType: parsed.data.actionType,
            externalRef: parsed.data.externalRef,
            payloadSummary: parsed.data.payloadSummary,
            status: parsed.data.status,
            errorClass: parsed.data.errorClass,
            errorMessage: parsed.data.errorMessage,
          });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "OPPORTUNITY_NOT_FOUND") {
      return Response.json({ error: "Opportunity not found" }, { status: 404 });
    }

    if (error instanceof Error && error.message === "TWENTY_API_KEY not set") {
      return Response.json({ error: "TWENTY_API_KEY not set" }, { status: 503 });
    }

    if (error instanceof Error && "code" in error && error.code === "OPPORTUNITY_SYNC_UNMAPPABLE") {
      return Response.json({ error: error.message }, { status: 400 });
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
      { error: error instanceof Error ? error.message : "Failed to write sync event" },
      { status: 500 },
    );
  }
}
