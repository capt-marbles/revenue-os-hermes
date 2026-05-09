import { db } from "@/db";
import { deals } from "@/db/schema";
import { and, eq, lt, notInArray } from "drizzle-orm";
import type { RegisteredTool } from "./types";

const CLOSED = ["contract_signed", "lost"];

const STAGE_THRESHOLDS: Record<string, number> = {
  reachout: 10,
  connected: 7,
  technical_evaluation: 14,
  quote_issued: 10,
  committed: 14,
  contract_signed: 30,
  default: 21,
};

export const crmStaleDeals: RegisteredTool = {
  definition: {
    name: "crm_stale_deals",
    description:
      "Find deals that haven't been updated recently. Returns deals past their expected activity threshold, sorted by staleness. Use this to identify pipeline that needs attention.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Override: flag any deal not updated in this many days. Omit to use per-stage thresholds.",
        },
        limit: { type: "number", description: "Max results (default 15)" },
      },
    },
  },
  scopes: ["steward", "cos", "scout"],
  async execute(input, tenantId) {
    const overrideDays = input.days as number | undefined;
    const limit = (input.limit as number) ?? 15;
    const now = Date.now();

    const rows = db
      .select()
      .from(deals)
      .where(and(eq(deals.tenantId, tenantId), notInArray(deals.stage, CLOSED)))
      .all();

    const stale = rows
      .map((d) => {
        const daysSince = Math.floor((now - new Date(d.updatedAt).getTime()) / 86_400_000);
        const threshold = overrideDays ?? (STAGE_THRESHOLDS[d.stage] ?? STAGE_THRESHOLDS.default);
        return { ...d, daysSince, threshold };
      })
      .filter((d) => d.daysSince >= d.threshold)
      .sort((a, b) => b.daysSince - a.daysSince)
      .slice(0, limit);

    if (stale.length === 0) return "No stale deals — pipeline looks healthy.";

    const lines = [
      `## Stale Deals (${stale.length})`,
      "",
      "| Name | Stage | Studio | Days Stale | Threshold |",
      "|------|-------|--------|------------|-----------|",
      ...stale.map((d) =>
        `| ${d.name} (${d.id.slice(-6)}) | ${d.stage} | ${d.studioName ?? "—"} | ${d.daysSince}d | ${d.threshold}d |`
      ),
    ];

    return lines.join("\n");
  },
};
