import { db } from "@/db";
import { goals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { RegisteredTool } from "./types";

export const updateGoal: RegisteredTool = {
  definition: {
    name: "update_goal",
    description:
      "Update an existing goal's title, description, priority, status, target metric, target value, current value, unit, or deadline. Match goals by title (fuzzy). Use to realign strategy, reprioritise, or record progress.",
    input_schema: {
      type: "object",
      properties: {
        goal_title: {
          type: "string",
          description: "Name of the goal to update (fuzzy matched)",
        },
        title: { type: "string", description: "New title for the goal" },
        description: { type: "string", description: "Updated description or strategic context" },
        status: {
          type: "string",
          enum: ["active", "achieved", "paused", "archived"],
          description: "New status",
        },
        priority: {
          type: "number",
          description: "Priority rank (lower = higher priority, e.g. 1 = top priority)",
        },
        target_metric: { type: "string", description: "What metric this goal tracks" },
        target_value: { type: "number", description: "Numeric target" },
        current_value: { type: "number", description: "Current progress value" },
        unit: { type: "string", description: "Unit of measurement (e.g. £, %, leads)" },
        deadline: { type: "string", description: "ISO date string for deadline" },
      },
      required: ["goal_title"],
    },
  },
  scopes: ["cos"],
  async execute(input, tenantId) {
    const goalTitle = (input.goal_title as string) ?? "";
    const allGoals = db.select().from(goals).where(eq(goals.tenantId, tenantId)).all();
    const match = allGoals.find(
      (g) =>
        g.title.toLowerCase().includes(goalTitle.toLowerCase()) ||
        goalTitle.toLowerCase().includes(g.title.toLowerCase()),
    );

    if (!match) {
      return `Goal not found matching "${goalTitle}". Available goals: ${allGoals.map((g) => g.title).join(", ")}`;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (input.title) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.status) updates.status = input.status;
    if (input.priority !== undefined) updates.priority = Number(input.priority);
    if (input.target_metric !== undefined) updates.targetMetric = input.target_metric;
    if (input.target_value !== undefined) updates.targetValue = Number(input.target_value);
    if (input.current_value !== undefined) updates.currentValue = Number(input.current_value);
    if (input.unit !== undefined) updates.unit = input.unit;
    if (input.deadline !== undefined) updates.deadline = input.deadline;

    db.update(goals).set(updates).where(and(eq(goals.id, match.id), eq(goals.tenantId, tenantId))).run();

    return `Goal "${match.title}" updated successfully.${input.title ? ` Renamed to "${input.title}".` : ""}${input.priority !== undefined ? ` Priority set to ${input.priority}.` : ""}${input.description ? " Description updated." : ""}`;
  },
};

export const createGoal: RegisteredTool = {
  definition: {
    name: "create_goal",
    description:
      "Create a new strategic goal. Use when the operator wants to add a new objective that doesn't exist yet.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Goal title" },
        description: { type: "string", description: "Strategic context or definition of success" },
        status: {
          type: "string",
          enum: ["active", "achieved", "paused", "archived"],
          description: "Initial status (default: active)",
        },
        priority: {
          type: "number",
          description: "Priority rank (1 = highest). Existing goals will be shifted down if needed.",
        },
        target_metric: { type: "string", description: "What metric this goal tracks" },
        target_value: { type: "number", description: "Numeric target" },
        unit: { type: "string", description: "Unit (e.g. £, %, leads)" },
        deadline: { type: "string", description: "ISO date string" },
      },
      required: ["title"],
    },
  },
  scopes: ["cos"],
  async execute(input, tenantId) {
    const title = input.title as string;
    const priority = input.priority !== undefined ? Number(input.priority) : 0;

    // If this is the new top priority, bump all existing goals down
    if (priority === 1) {
      const existing = db.select().from(goals).where(eq(goals.tenantId, tenantId)).all();
      for (const g of existing) {
        if ((g.priority ?? 0) >= 1) {
          db.update(goals)
            .set({ priority: (g.priority ?? 0) + 1, updatedAt: new Date().toISOString() })
            .where(eq(goals.id, g.id))
            .run();
        }
      }
    }

    const goal = {
      id: ulid(),
      tenantId,
      title,
      description: (input.description as string) ?? null,
      status: (input.status as string) ?? "active",
      priority,
      targetMetric: (input.target_metric as string) ?? null,
      targetValue: input.target_value !== undefined ? Number(input.target_value) : null,
      currentValue: 0,
      unit: (input.unit as string) ?? null,
      deadline: (input.deadline as string) ?? null,
    };

    db.insert(goals).values(goal).run();

    return `Goal "${title}" created successfully with priority ${priority}.`;
  },
};
