export const TASK_STATUSES = ["backlog", "todo", "in_progress", "done", "blocked"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export const GOAL_STATUSES = ["active", "achieved", "paused", "archived"] as const;
export type GoalStatus = typeof GOAL_STATUSES[number];

export const AGENT_SOURCES = ["marketing-skills", "agency-agents", "custom"] as const;
export type AgentSource = typeof AGENT_SOURCES[number];

export const AGENT_STATUSES = ["idle", "running", "disabled", "error"] as const;
export type AgentStatus = typeof AGENT_STATUSES[number];

export const RUN_STATUSES = ["queued", "running", "success", "failed", "cancelled"] as const;
export type RunStatus = typeof RUN_STATUSES[number];

export const MEMORY_CATEGORIES = ["icp", "brand_voice", "tools", "connectors", "competitors", "custom"] as const;
export type MemoryCategory = typeof MEMORY_CATEGORIES[number];

export const KANBAN_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
];
