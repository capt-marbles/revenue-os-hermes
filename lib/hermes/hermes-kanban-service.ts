/**
 * hermes-kanban-service.ts
 *
 * Low-level wrapper around the `hermes kanban` CLI.
 * All kanban operations go through here — keeps the CLI invocation details in one place.
 *
 * Board: uses the default Hermes kanban board (HERMES_KANBAN_BOARD env var or `hermes kanban init`).
 * Workers: maps Revenue OS agent slugs to Hermes profiles.
 */

import { spawn } from "child_process";
import { promisify } from "util";

const execFile = promisify((await import("child_process")).execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export type KanbanStatus = "triage" | "todo" | "ready" | "working" | "done" | "blocked" | "archived";

export interface HermesTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: KanbanStatus;
  priority: number;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  workspace_kind: string;
  workspace_path: string | null;
  tenant: string | null;
  max_runtime_seconds: number | null;
  last_heartbeat_at: number | null;
  consecutive_failures: number;
  skills: string[];
  max_retries: number | null;
}

export interface HermesTaskRun {
  id: number;
  task_id: string;
  profile: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  outcome: string | null;
  summary: string | null;
  metadata: string | null;
  error: string | null;
}

export interface TaskEvent {
  id: number;
  task_id: string;
  run_id: number | null;
  kind: string;
  payload: string | null;
  created_at: number;
}

export interface KanbanStats {
  triage: number;
  todo: number;
  ready: number;
  working: number;
  done: number;
  blocked: number;
  archived: number;
  oldest_ready_age_ms: number | null;
}

export interface CreateTaskOptions {
  title: string;
  body?: string;
  assignee?: string; // Hermes profile name
  parentIds?: string[];
  workspace?: "scratch" | `dir:${string}`;
  tenant?: string;
  priority?: number;
  triage?: boolean;   // park in triage → specifier fleshes out spec
  skills?: string[];  // force-loaded skills for the worker
  maxRuntimeSeconds?: number;
  maxRetries?: number;
  createdBy?: string;
  idempotencyKey?: string;
}

export interface LinkTasksOptions {
  parentId: string;
  childId: string;
}

// ─── CLI spawn helper ─────────────────────────────────────────────────────────

function hermesKanban(
  args: string[],
  options: { timeout?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("hermes", ["kanban", ...args], {
      timeout: options.timeout ?? 30_000,
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d) => { stdout += d; });
    proc.stderr?.on("data", (d) => { stderr += d; });

    proc.on("error", reject);

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

// ─── JSON output helpers ──────────────────────────────────────────────────────

function parseJsonOutput(stdout: string): any {
  try {
    // The --json flag makes hermes output clean JSON
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Failed to parse JSON from hermes kanban output: ${stdout.slice(0, 200)}`);
  }
}

// ─── CRUD Operations ───────────────────────────────────────────────────────────

/**
 * Create a new task on the Hermes kanban board.
 */
export async function kanbanCreate(opts: CreateTaskOptions): Promise<HermesTask> {
  const args = ["create", opts.title];

  if (opts.body) args.push("--body", opts.body);
  if (opts.assignee) args.push("--assignee", opts.assignee);
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.tenant) args.push("--tenant", opts.tenant);
  if (opts.priority !== undefined) args.push("--priority", String(opts.priority));
  if (opts.triage) args.push("--triage");
  if (opts.skills?.length) opts.skills.forEach((s) => args.push("--skill", s));
  if (opts.maxRuntimeSeconds) args.push("--max-runtime", String(opts.maxRuntimeSeconds));
  if (opts.maxRetries !== undefined) args.push("--max-retries", String(opts.maxRetries));
  if (opts.createdBy) args.push("--created-by", opts.createdBy);
  if (opts.idempotencyKey) args.push("--idempotency-key", opts.idempotencyKey);

  // Parent links — need to be done separately after creation
  const parentIds = opts.parentIds ?? [];

  args.push("--json");

  const { stdout, exitCode } = await hermesKanban(args);

  if (exitCode !== 0) {
    throw new Error(`hermes kanban create failed (exit ${exitCode}): ${stdout}`);
  }

  const result = parseJsonOutput(stdout);

  // Handle the case where stdout is an array with the task at index 0
  const task = Array.isArray(result) ? result[0] : result;

  // Now link parents
  for (const parentId of parentIds) {
    try {
      await kanbanLink({ parentId, childId: task.id });
    } catch {
      // Link may already exist — non-fatal
    }
  }

  return task;
}

/**
 * Get a single task by id.
 */
export async function kanbanShow(taskId: string): Promise<HermesTask | null> {
  const { stdout, exitCode } = await hermesKanban(["show", taskId, "--json"]);

  if (exitCode !== 0) return null;

  try {
    return parseJsonOutput(stdout);
  } catch {
    return null;
  }
}

/**
 * List tasks, optionally filtered by assignee or status.
 */
export async function kanbanList(opts: {
  assignee?: string;
  status?: KanbanStatus;
  limit?: number;
} = {}): Promise<HermesTask[]> {
  const args = ["list", "--json"];

  if (opts.assignee) args.push("--assignee", opts.assignee);
  if (opts.status) args.push("--status", opts.status);
  if (opts.limit) args.push("--limit", String(opts.limit));

  const { stdout, exitCode } = await hermesKanban(args);

  if (exitCode !== 0) {
    throw new Error(`hermes kanban list failed (exit ${exitCode}): ${stdout}`);
  }

  const result = parseJsonOutput(stdout);
  return Array.isArray(result) ? result : [];
}

/**
 * Add a parent→child dependency.
 * Child won't be promoted to ready until parent reaches done.
 */
export async function kanbanLink(opts: LinkTasksOptions): Promise<void> {
  const { exitCode } = await hermesKanban([
    "link", opts.parentId, opts.childId, "--json",
  ]);

  if (exitCode !== 0) {
    throw new Error(`hermes kanban link failed: parent=${opts.parentId} child=${opts.childId}`);
  }
}

/**
 * Remove a parent→child dependency.
 */
export async function kanbanUnlink(opts: LinkTasksOptions): Promise<void> {
  await hermesKanban(["unlink", opts.parentId, opts.childId]);
}

/**
 * Atomically claim a task (sets status to working, returns workspace path).
 */
export async function kanbanClaim(taskId: string): Promise<string | null> {
  const { stdout, exitCode } = await hermesKanban(["claim", taskId, "--json"]);

  if (exitCode !== 0) return null;

  try {
    const result = parseJsonOutput(stdout);
    // claim returns the resolved workspace path
    return result.workspace ?? result.path ?? result ?? null;
  } catch {
    return null;
  }
}

/**
 * Mark one or more tasks as done.
 */
export async function kanbanComplete(
  taskIds: string[],
  opts: { summary?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  const args = ["complete", "--json", ...taskIds];
  if (opts.summary) args.push("--summary", opts.summary);
  if (opts.metadata) args.push("--metadata", JSON.stringify(opts.metadata));

  const { stdout, exitCode } = await hermesKanban(args);
  if (exitCode !== 0) {
    throw new Error(`hermes kanban complete failed: ${stdout}`);
  }
}

/**
 * Mark one or more tasks as blocked.
 */
export async function kanbanBlock(taskIds: string[], reason: string): Promise<void> {
  const args = ["block", ...taskIds];
  const { exitCode } = await hermesKanban(args);
  if (exitCode !== 0) {
    throw new Error(`hermes kanban block failed: ${reason}`);
  }
}

/**
 * Unblock tasks.
 */
export async function kanbanUnblock(taskIds: string[]): Promise<void> {
  const args = ["unblock", ...taskIds];
  await hermesKanban(args);
}

/**
 * Add a comment to a task.
 */
export async function kanbanComment(taskId: string, author: string, body: string): Promise<void> {
  const { exitCode } = await hermesKanban(["comment", taskId, "--author", author, "--body", body]);
  if (exitCode !== 0) {
    throw new Error(`hermes kanban comment failed for task ${taskId}`);
  }
}

/**
 * Edit recovery fields on a completed task.
 */
export async function kanbanEdit(
  taskId: string,
  opts: {
    assignee?: string;
    status?: KanbanStatus;
    summary?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const args = ["edit", taskId, "--json"];
  if (opts.assignee) args.push("--assignee", opts.assignee);
  if (opts.status) args.push("--status", opts.status);

  const { exitCode } = await hermesKanban(args);
  if (exitCode !== 0) {
    throw new Error(`hermes kanban edit failed for task ${taskId}`);
  }
}

/**
 * Reclaim a task (abort the running worker, reset to ready).
 */
export async function kanbanReclaim(taskId: string): Promise<void> {
  const { exitCode } = await hermesKanban(["reclaim", taskId]);
  if (exitCode !== 0) {
    throw new Error(`hermes kanban reclaim failed for task ${taskId}`);
  }
}

/**
 * Reassign a task to a different profile.
 */
export async function kanbanReassign(taskId: string, newAssignee: string): Promise<void> {
  const { exitCode } = await hermesKanban(["reassign", taskId, newAssignee, "--reclaim"]);
  if (exitCode !== 0) {
    throw new Error(`hermes kanban reassign failed: ${taskId} → ${newAssignee}`);
  }
}

/**
 * Archive a task.
 */
export async function kanbanArchive(taskIds: string[]): Promise<void> {
  const { exitCode } = await hermesKanban(["archive", ...taskIds]);
  if (exitCode !== 0) {
    throw new Error(`hermes kanban archive failed`);
  }
}

/**
 * Get per-status + per-assignee counts.
 */
export async function kanbanStats(): Promise<KanbanStats> {
  const { stdout, exitCode } = await hermesKanban(["stats", "--json"]);

  if (exitCode !== 0) {
    throw new Error(`hermes kanban stats failed: ${stdout}`);
  }

  const result = parseJsonOutput(stdout);

  return {
    triage: result.triage ?? result.Triage ?? 0,
    todo: result.todo ?? 0,
    ready: result.ready ?? 0,
    working: result.working ?? 0,
    done: result.done ?? 0,
    blocked: result.blocked ?? 0,
    archived: result.archived ?? 0,
    oldest_ready_age_ms: result.oldest_ready_age_ms ?? null,
  };
}

/**
 * Get attempt history for a task.
 */
export async function kanbanRuns(taskId: string): Promise<HermesTaskRun[]> {
  const { stdout, exitCode } = await hermesKanban(["runs", taskId, "--json"]);

  if (exitCode !== 0) return [];

  const result = parseJsonOutput(stdout);
  return Array.isArray(result) ? result : [];
}

/**
 * Get events for a task.
 */
export async function kanbanTail(taskId: string): Promise<TaskEvent[]> {
  const { stdout, exitCode } = await hermesKanban(["log", taskId, "--json"]);

  if (exitCode !== 0) return [];

  const result = parseJsonOutput(stdout);
  return Array.isArray(result) ? result : [];
}

/**
 * Emit a heartbeat for a running task.
 */
export async function kanbanHeartbeat(taskId: string, note?: string): Promise<void> {
  const args = ["heartbeat", taskId];
  if (note) args.push("--note", note);
  await hermesKanban(args);
}

/**
 * List known profiles + per-profile task counts.
 */
export async function kanbanAssignees(): Promise<Record<string, { count: number; active: number }>> {
  const { stdout, exitCode } = await hermesKanban(["assignees", "--json"]);

  if (exitCode !== 0) return {};

  const result = parseJsonOutput(stdout);
  return result ?? {};
}

/**
 * Dispatcher pass: reclaim stale tasks, promote ready, spawn workers.
 */
export async function kanbanDispatch(): Promise<{ reclaimed: number; promoted: number; spawned: number }> {
  const { stdout, exitCode } = await hermesKanban(["dispatch", "--json"]);

  if (exitCode !== 0) {
    throw new Error(`hermes kanban dispatch failed: ${stdout}`);
  }

  const result = parseJsonOutput(stdout);
  return {
    reclaimed: result.reclaimed ?? 0,
    promoted: result.promoted ?? 0,
    spawned: result.spawned ?? 0,
  };
}

/**
 * Watch mode: live-stream events for all tasks to terminal.
 * Returns the spawned subprocess — caller must call proc.kill() to stop.
 */
export function kanbanWatch(): { proc: ReturnType<typeof spawn>; stop: () => void } {
  const proc = spawn("hermes", ["kanban", "watch"], {
    env: { ...process.env, NO_COLOR: "1" },
  });

  return {
    proc,
    stop: () => {
      proc.kill("SIGTERM");
    },
  };
}