import { db } from "@/db";
import { tasks, agents, goals } from "@/db/schema";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import type { RegisteredTool } from "./types";

export const getTasks: RegisteredTool = {
  definition: {
    name: "get_tasks",
    description:
      "Search and list tasks by keyword, status, assignee, or goal. Use to find what's being worked on, who owns it, and what state it's in. Essential before dispatching a specialist — find the task first, then ask the assigned agent for a status update.",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Keyword to search in task title or description (optional)",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "done", "blocked"],
          description: "Filter by status (optional)",
        },
        assigneeSlug: {
          type: "string",
          description: "Filter by assigned agent slug e.g. 'scout', 'steward' (optional)",
        },
        limit: {
          type: "number",
          description: "Max tasks to return (default 20)",
        },
      },
    },
  },
  scopes: ["cos", "steward"],
  async execute(input, tenantId) {
    const search = input.search as string | undefined;
    const status = input.status as string | undefined;
    const assigneeSlug = input.assigneeSlug as string | undefined;
    const limit = Math.min((input.limit as number | undefined) ?? 20, 50);

    // Resolve assigneeSlug to agent ID
    let assigneeId: string | undefined;
    if (assigneeSlug) {
      const agent = db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.tenantId, tenantId), eq(agents.slug, assigneeSlug)))
        .get();
      assigneeId = agent?.id;
    }

    const conditions = [eq(tasks.tenantId, tenantId)];

    if (status) conditions.push(eq(tasks.status, status));
    if (assigneeId) conditions.push(eq(tasks.assigneeId, assigneeId));
    if (search) {
      conditions.push(
        or(
          like(tasks.title, `%${search}%`),
          like(tasks.description, `%${search}%`),
        )!,
      );
    }

    const rows = db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        assigneeType: tasks.assigneeType,
        assigneeId: tasks.assigneeId,
        goalId: tasks.goalId,
        description: tasks.description,
        dueDate: tasks.dueDate,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.updatedAt))
      .limit(limit)
      .all();

    if (rows.length === 0) {
      const ctx = [
        search ? `matching "${search}"` : null,
        status ? `with status "${status}"` : null,
        assigneeSlug ? `assigned to ${assigneeSlug}` : null,
      ].filter(Boolean).join(", ");
      return `No tasks found${ctx ? ` ${ctx}` : ""}.`;
    }

    // Batch-load agent names and goal titles to avoid N+1
    const agentIds = [...new Set(rows.map((r) => r.assigneeId).filter((id): id is string => !!id))];
    const goalIds = [...new Set(rows.map((r) => r.goalId).filter((id): id is string => !!id))];

    const agentMap = new Map<string, string>();
    if (agentIds.length > 0) {
      const agentRows = db.select({ id: agents.id, slug: agents.slug, name: agents.name })
        .from(agents)
        .all();
      for (const a of agentRows) {
        if (agentIds.includes(a.id)) agentMap.set(a.id, `${a.name} (${a.slug})`);
      }
    }

    const goalMap = new Map<string, string>();
    if (goalIds.length > 0) {
      const goalRows = db.select({ id: goals.id, title: goals.title }).from(goals).all();
      for (const g of goalRows) {
        if (goalIds.includes(g.id)) goalMap.set(g.id, g.title);
      }
    }

    const statusIcon: Record<string, string> = {
      backlog: "○",
      todo: "◔",
      in_progress: "◑",
      done: "●",
      blocked: "✗",
    };

    const lines = [`## Tasks (${rows.length} found)\n`];

    for (const t of rows) {
      const icon = statusIcon[t.status] ?? "○";
      const assignee = t.assigneeId
        ? (agentMap.get(t.assigneeId) ?? t.assigneeId)
        : t.assigneeType === "human" ? "human" : "unassigned";
      const goal = t.goalId ? goalMap.get(t.goalId) : null;
      const due = t.dueDate ? ` due ${new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";

      lines.push(`${icon} **${t.title}** [${t.priority}]`);
      lines.push(`  Status: ${t.status} | Assignee: ${assignee}${due}`);
      if (goal) lines.push(`  Goal: ${goal}`);
      if (t.description) {
        const desc = t.description.length > 120 ? `${t.description.slice(0, 120)}…` : t.description;
        lines.push(`  ${desc}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  },
};
