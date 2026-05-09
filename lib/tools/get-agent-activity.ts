import { db } from "@/db";
import { agents, agentRuns } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { RegisteredTool } from "./types";

export const getAgentActivity: RegisteredTool = {
  definition: {
    name: "get_agent_activity",
    description:
      "Get recent run stats for specialist agents — Scout, Steward, Outreach, etc. Shows run counts, success rates, and last activity. Use to understand whether agents are actually working.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days to look back (default 7)" },
      },
    },
  },
  scopes: ["cos"],
  async execute(input, tenantId) {
    const days = (input.days as number) ?? 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const rows = db
      .select({
        agentName: agents.name,
        runs: sql<number>`count(*)`,
        successes: sql<number>`sum(case when ${agentRuns.status} = 'success' then 1 else 0 end)`,
        avgDurationMs: sql<number>`round(avg(${agentRuns.durationMs}), 0)`,
        lastRun: sql<string>`max(${agentRuns.createdAt})`,
      })
      .from(agentRuns)
      .leftJoin(agents, eq(agentRuns.agentId, agents.id))
      .where(and(eq(agentRuns.tenantId, tenantId), gte(agentRuns.createdAt, since)))
      .groupBy(agentRuns.agentId)
      .orderBy(sql`count(*) desc`)
      .all();

    if (rows.length === 0) return `No agent activity in the last ${days} days.`;

    const lines = [
      `## Agent Activity (last ${days} days)\n`,
      "| Agent | Runs | Success Rate | Avg Duration | Last Run |",
      "|-------|------|-------------|--------------|----------|",
      ...rows.map((a) => {
        const rate = a.runs > 0 ? Math.round((a.successes / a.runs) * 100) : 0;
        const dur = a.avgDurationMs ? `${(a.avgDurationMs / 1000).toFixed(1)}s` : "—";
        const last = a.lastRun
          ? new Date(a.lastRun).toLocaleDateString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            })
          : "—";
        return `| ${a.agentName ?? "Unknown"} | ${a.runs} | ${rate}% | ${dur} | ${last} |`;
      }),
    ];

    return lines.join("\n");
  },
};
