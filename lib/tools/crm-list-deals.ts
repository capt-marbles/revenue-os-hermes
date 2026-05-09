import { db } from "@/db";
import { deals } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import type { RegisteredTool } from "./types";

export const crmListDeals: RegisteredTool = {
  definition: {
    name: "crm_list_deals",
    description:
      "List deals in the pipeline. Filter by stage to see what's in a specific column. Returns deal id, name, stage, studio, MRR, close date, and days since last update.",
    input_schema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          description:
            "Filter by stage: reachout, connected, technical_evaluation, quote_issued, committed, contract_signed, lost. Omit to list all.",
        },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  scopes: ["steward", "cos", "scout"],
  async execute(input, tenantId) {
    const stage = input.stage as string | undefined;
    const limit = (input.limit as number) ?? 20;

    const where = stage
      ? and(eq(deals.tenantId, tenantId), eq(deals.stage, stage))
      : eq(deals.tenantId, tenantId);

    const rows = db
      .select()
      .from(deals)
      .where(where)
      .orderBy(desc(deals.updatedAt))
      .limit(limit)
      .all();

    if (rows.length === 0) return stage ? `No deals in stage: ${stage}` : "No deals found.";

    const now = Date.now();
    const lines = [
      `## Deals${stage ? ` — ${stage}` : ""} (${rows.length})`,
      "",
      "| Name | Stage | Studio | MRR | Close Date | Days Stale |",
      "|------|-------|--------|-----|------------|------------|",
      ...rows.map((d) => {
        const stale = Math.floor((now - new Date(d.updatedAt).getTime()) / 86_400_000);
        const mrr = d.mrr != null ? `$${d.mrr.toLocaleString()}` : "—";
        return `| ${d.name} (${d.id.slice(-6)}) | ${d.stage} | ${d.studioName ?? "—"} | ${mrr} | ${d.closeDate ?? "—"} | ${stale}d |`;
      }),
    ];

    return lines.join("\n");
  },
};
