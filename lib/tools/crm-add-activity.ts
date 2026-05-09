import { db } from "@/db";
import { deals, dealActivities } from "@/db/schema";
import { and, eq, or, like } from "drizzle-orm";
import { ulid } from "ulid";
import type { RegisteredTool } from "./types";

export const crmAddActivity: RegisteredTool = {
  definition: {
    name: "crm_add_activity",
    description:
      "Add an activity note to a deal's history. Use for logging calls, emails, meetings, or observations. Does not change the deal stage.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "Deal ID or last 6 characters" },
        deal_name: { type: "string", description: "Exact deal name (alternative to deal_id)" },
        content: { type: "string", description: "Activity note content" },
        type: {
          type: "string",
          description: "Activity type: note, email, call, meeting (default: note)",
        },
      },
      required: ["content"],
    },
  },
  scopes: ["steward", "cos"],
  async execute(input, tenantId) {
    const dealId = input.deal_id as string | undefined;
    const dealName = input.deal_name as string | undefined;
    const content = input.content as string;
    const type = (input.type as string) ?? "note";

    if (!dealId && !dealName) return "Provide deal_id or deal_name.";
    if (!content.trim()) return "Content cannot be empty.";

    const deal = db
      .select({ id: deals.id, name: deals.name })
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

    const now = new Date().toISOString();
    db.insert(dealActivities).values({
      id: ulid(),
      dealId: deal.id,
      content,
      type,
      createdAt: now,
    }).run();

    db.update(deals).set({ updatedAt: now }).where(eq(deals.id, deal.id)).run();

    return `Activity logged on "${deal.name}": ${content}`;
  },
};
