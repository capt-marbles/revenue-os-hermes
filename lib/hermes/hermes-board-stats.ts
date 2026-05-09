/**
 * hermes-board-stats.ts
 *
 * Fetches Hermes Kanban board stats and maps them to the Revenue OS
 * command center dashboard format.
 */

import { hermesBridge } from "./hermes-task-provider";

export interface BoardStats {
  kanban: {
    totalTasks: number;
    byStatus: {
      triage: number;
      todo: number;
      ready: number;
      working: number;
      done: number;
      blocked: number;
      archived: number;
    };
    oldestReadyAgeMs: number | null;
  };
  assignees: Array<{
    profile: string;
    taskCount: number;
    activeWorkers: number;
  }>;
  dispatcher: {
    lastRun: string | null;
    reclaimedCount: number;
    promotedCount: number;
    spawnedCount: number;
  };
}

/**
 * Get Hermes Kanban board stats formatted for the Revenue OS dashboard.
 */
export async function getHermesBoardStats(): Promise<BoardStats> {
  const [stats, assignees] = await Promise.all([
    hermesBridge.getBoardStats(),
    hermesBridge.getAssigneeStats(),
  ]);

  const assigneeList = Object.entries(assignees).map(([profile, data]) => ({
    profile,
    taskCount: data.count,
    activeWorkers: data.active,
  }));

  return {
    kanban: {
      totalTasks: stats.triage + stats.todo + stats.ready + stats.working + stats.done + stats.blocked + stats.archived,
      byStatus: {
        triage: stats.triage,
        todo: stats.todo,
        ready: stats.ready,
        working: stats.working,
        done: stats.done,
        blocked: stats.blocked,
        archived: stats.archived,
      },
      oldestReadyAgeMs: stats.oldest_ready_age_ms,
    },
    assignees: assigneeList,
    dispatcher: {
      lastRun: new Date().toISOString(),
      reclaimedCount: 0,
      promotedCount: 0,
      spawnedCount: 0,
    },
  };
}

/**
 * Map Hermes task status to Revenue OS task status.
 */
export function hermesStatusToRevenueOs(hermesStatus: string): string {
  switch (hermesStatus) {
    case "triage":
    case "todo":
      return "backlog";
    case "ready":
      return "todo";
    case "working":
      return "in_progress";
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    case "archived":
      return "done";
    default:
      return "backlog";
  }
}

/**
 * Map Revenue OS task priority to Hermes task priority number.
 */
export function revenueOsPriorityToHermes(priority: string): number {
  switch (priority) {
    case "urgent": return 100;
    case "high":   return 80;
    case "medium": return 50;
    case "low":    return 20;
    default:       return 50;
  }
}
