import { db } from "@/db";
import { deals, dealActivities } from "@/db/schema";
import { and, eq, or, like } from "drizzle-orm";
import { ulid } from "ulid";
import type { RegisteredTool } from "./types";
import { LOCAL_DEAL_STAGES } from "@/lib/crm/deal-stages";

const VALID_STAGES = LOCAL_DEAL_STAGES;

export const crmUpdateDeal: RegisteredTool = {
  definition: {
    name: "crm_update_deal",
    description:
      "Update a deal's stage, MRR, close date, or notes. Use the deal id (last 6 chars are fine) or an exact name match. Always log a reason when changing stage.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "Deal ID or last 6 characters of the ID" },
        deal_name: { type: "string", description: "Exact deal name (alternative to deal_id)" },
        stage: { type: "string", description: `New stage. Valid values: ${VALID_STAGES.join(", ")}` },
        mrr: { type: "number", description: "Monthly recurring revenue in USD" },
        close_date: { type: "string", description: "Expected close date (YYYY-MM-DD)" },
        notes: { type: "string", description: "Notes to append as an activity log entry" },
        reason: { type: "string", description: "Reason for the change (logged automatically)" },
      },
    },
  },
  scopes: ["steward", "cos"],
  async execute(input, tenantId) {
    const dealId = input.deal_id as string | undefined;
    const dealName = input.deal_name as string | undefined;

    if (!dealId && !dealName) return "Provide deal_id or deal_name.";

    const deal = db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.tenantId, tenantId),
          dealId
            ? or(eq(deals.id, dealId), like(deals.id, `%${dealId}`))
            : eq(deals.name, dealName!),
        ),
      )
      .get();

    if (!deal) return `Deal not found: ${dealId ?? dealName}`;

    const stage = input.stage as string | undefined;
    if (stage && !(VALID_STAGES as readonly string[]).includes(stage)) {
      return `Invalid stage "${stage}". Valid: ${VALID_STAGES.join(", ")}`;
    }

    const now = new Date().toISOString();
    const updates: Partial<typeof deal> = { updatedAt: now };
    if (stage) updates.stage = stage;
    if (input.mrr != null) updates.mrr = input.mrr as number;
    if (input.close_date) updates.closeDate = input.close_date as string;

    db.update(deals).set(updates).where(eq(deals.id, deal.id)).run();

    const changes: string[] = [];
    if (stage && stage !== deal.stage) changes.push(`stage: ${deal.stage} → ${stage}`);
    if (input.mrr != null) changes.push(`mrr: $${input.mrr}`);
    if (input.close_date) changes.push(`close_date: ${input.close_date}`);

    const reason = input.reason as string | undefined;
    const notes = input.notes as string | undefined;
    const activityContent = [
      changes.length ? `Updated: ${changes.join(", ")}` : null,
      reason ? `Reason: ${reason}` : null,
      notes ?? null,
    ]
      .filter(Boolean)
      .join(" — ");

    if (activityContent) {
      db.insert(dealActivities).values({
        id: ulid(),
        dealId: deal.id,
        content: activityContent,
        type: "note",
        createdAt: now,
      }).run();
    }

    return `Updated deal "${deal.name}" (${deal.id.slice(-6)}): ${changes.length ? changes.join(", ") : "no field changes"}${reason ? ` — ${reason}` : ""}`;
  },
};
