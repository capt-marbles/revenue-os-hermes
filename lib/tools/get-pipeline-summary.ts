import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { getCloseProbability, calculateWeightedProbability, PIPELINE_CONFIG } from "@/lib/pipeline/config";
import type { RegisteredTool } from "./types";

export const getPipelineSummary: RegisteredTool = {
  definition: {
    name: "get_pipeline_summary",
    description:
      "Get a count of opportunities by status stage and top examples per stage. Use this to understand where leads are stuck and how the pipeline is flowing.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max examples per stage (default 3)" },
      },
    },
  },
  scopes: ["cos", "steward", "outreach", "marketing"],
  async execute(input, tenantId) {
    const limit = (input.limit as number) ?? 3;

    const stageCounts = db
      .select({
        status: opportunities.status,
        count: sql<number>`count(*)`,
        avgScore: sql<number>`round(avg(${opportunities.score}), 2)`,
      })
      .from(opportunities)
      .where(eq(opportunities.tenantId, tenantId))
      .groupBy(opportunities.status)
      .orderBy(sql`count(*) desc`)
      .all();

    if (stageCounts.length === 0) return "No opportunities in pipeline.";

    const total = stageCounts.reduce((s, r) => s + r.count, 0);
    
    // Calculate weighted pipeline value using new close probabilities
    let totalPipelineValue = 0;
    const stageDetails = stageCounts.map((stage) => {
      const probability = getCloseProbability(stage.status);
      const stageConfig = PIPELINE_CONFIG.stages.find(s => s.id === stage.status);
      const expectedDays = stageConfig?.expectedDaysInStage ?? 7;
      
      return {
        ...stage,
        probability,
        expectedDays,
        weightedValue: stage.count * probability / 100
      };
    });
    
    totalPipelineValue = stageDetails.reduce((sum, stage) => sum + stage.weightedValue, 0);
    
    const lines = [
      `## Pipeline Summary — ${total} total opportunities`,
      `**Weighted Pipeline Value:** ${totalPipelineValue.toFixed(1)} opportunity equivalents\\n`,
      `**Updated for Extended Decision Cycles:** Studios now taking 30-60 days (vs 7-14 days pre-Hathora deadline)\\n`,
      "| Stage | Count | Avg Score | Close % | Exp. Days |",
      "|-------|-------|-----------|---------|-----------|",
      ...stageDetails.map((r) => 
        `| ${r.status} | ${r.count} | ${r.avgScore ?? "—"} | ${r.probability}% | ${r.expectedDays}d |`
      ),
    ];

    for (const { status } of stageCounts.slice(0, 3)) {
      const examples = db
        .select({
          title: opportunities.title,
          accountName: opportunities.accountName,
          score: opportunities.score,
          lastActivityAt: opportunities.lastActivityAt,
        })
        .from(opportunities)
        .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.status, status)))
        .orderBy(desc(opportunities.score))
        .limit(limit)
        .all();

      if (examples.length > 0) {
        lines.push(`\n**${status}:**`);
        for (const ex of examples) {
          const last = ex.lastActivityAt
            ? new Date(ex.lastActivityAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "no activity";
          lines.push(`- ${ex.title} (${ex.accountName ?? "unknown"}) — score: ${ex.score}, last: ${last}`);
        }
      }
    }

    return lines.join("\n");
  },
};
