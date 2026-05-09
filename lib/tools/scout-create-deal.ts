import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ulid } from "ulid";
import type { RegisteredTool } from "./types";

export const scoutCreateDeal: RegisteredTool = {
  definition: {
    name: "crm_create_deal",
    description: `Push a validated lead into the Revenue OS CRM pipeline as a new deal.
Use after confirming a studio is a real target with evidence of Multiplay/Hathora dependency.

The deal lands in the 'reachout' stage by default. Steward and the operator can then advance it.

Required: name (studio deal name), studio_name
Recommended: contact_name, contact_email, notes (include your evidence), sales_motion`,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Deal name (e.g. 'Rebellion — Multiplay migration')" },
        studio_name: { type: "string", description: "Studio / company name" },
        contact_name: { type: "string", description: "Primary contact name" },
        contact_email: { type: "string", description: "Primary contact email" },
        mrr: { type: "number", description: "Estimated monthly recurring revenue in USD" },
        notes: { type: "string", description: "Evidence, signal source, and context. Be specific." },
        sales_motion: {
          type: "string",
          enum: ["outbound", "inbound", "partner", "referral", "expansion"],
          description: "How this lead was sourced (default: outbound)",
        },
        close_date: { type: "string", description: "Expected close date YYYY-MM-DD" },
      },
      required: ["name", "studio_name"],
    },
  },
  scopes: ["scout"],
  async execute(input, tenantId) {
    const name = String(input.name ?? "").trim();
    const studioName = String(input.studio_name ?? "").trim();

    if (!name || !studioName) return "crm_create_deal: name and studio_name are required";

    // Check for an existing deal with this name for this studio to avoid duplicates
    const existing = db
      .select({ id: deals.id, stage: deals.stage })
      .from(deals)
      .where(and(eq(deals.tenantId, tenantId), eq(deals.name, name)))
      .get();

    if (existing) {
      return `Deal already exists: "${name}" (ID: ${existing.id}, stage: ${existing.stage}). Use crm_update_deal or crm_add_activity to update it.`;
    }

    const id = ulid();
    const now = new Date().toISOString();

    db.insert(deals).values({
      id,
      tenantId,
      name,
      stage: "reachout",
      salesMotion: String(input.sales_motion ?? "outbound"),
      studioName,
      contactName: input.contact_name ? String(input.contact_name) : null,
      contactEmail: input.contact_email ? String(input.contact_email) : null,
      mrr: typeof input.mrr === "number" ? input.mrr : null,
      notes: input.notes ? String(input.notes) : null,
      closeDate: input.close_date ? String(input.close_date) : null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return [
      `✅ Deal created: **${name}**`,
      `ID: ${id}`,
      `Stage: reachout`,
      `Studio: ${studioName}`,
      input.contact_name ? `Contact: ${input.contact_name}${input.contact_email ? ` <${input.contact_email}>` : ""}` : "",
      input.mrr ? `MRR: $${input.mrr}/mo` : "",
    ].filter(Boolean).join("\n");
  },
};
