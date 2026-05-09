import { db } from "@/db";
import { goals, tasks } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { RegisteredTool } from "./types";

export const getGoals: RegisteredTool = {
  definition: {
    name: "get_goals",
    description:
      "Get current goals with progress, deadlines, and task completion. Use to understand what the team is optimising for and how far off target they are.",
    input_schema: { type: "object", properties: {} },
  },
  scopes: ["cos", "steward", "outreach", "marketing"],
  async execute(_input, tenantId) {
    const allGoals = db.select().from(goals).where(eq(goals.tenantId, tenantId)).all();
    if (allGoals.length === 0) return "No goals defined.";

    const tasksByGoal = db
      .select({
        goalId: tasks.goalId,
        total: sql<number>`count(*)`,
        done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
        inProgress: sql<number>`sum(case when ${tasks.status} = 'in_progress' then 1 else 0 end)`,
      })
      .from(tasks)
      .where(eq(tasks.tenantId, tenantId))
      .groupBy(tasks.goalId)
      .all();

    const taskMap = new Map(tasksByGoal.map((t) => [t.goalId, t]));
    const lines = ["## Goals\n"];

    for (const g of allGoals) {
      const tc = taskMap.get(g.id);
      const progress =
        g.targetValue && g.currentValue
          ? Math.round((g.currentValue / g.targetValue) * 100)
          : tc && tc.total > 0
            ? Math.round((tc.done / tc.total) * 100)
            : 0;
      const deadline = g.deadline
        ? new Date(g.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "No deadline";

      lines.push(`### ${g.title} (${g.status})`);
      lines.push(`- Progress: ${g.currentValue ?? 0} / ${g.targetValue ?? "?"} ${g.unit ?? ""} (${progress}%)`);
      lines.push(`- Deadline: ${deadline}`);
      if (tc) lines.push(`- Tasks: ${tc.done}/${tc.total} done, ${tc.inProgress} in progress`);
      lines.push("");
    }

    return lines.join("\n");
  },
};
