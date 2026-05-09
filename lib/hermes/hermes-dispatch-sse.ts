/**
 * hermes-dispatch-sse.ts
 *
 * Wraps `dispatchRevenueOsAgentToHermes` with Server-Sent Events streaming.
 *
 * The SSE stream follows the `hermes kanban tail <taskId>` output to emit
 * real-time events: heartbeat, log, done, blocked, failed.
 *
 * This lets callers (e.g. the scheduler API route) get live progress while
 * a Hermes task is running, rather than just getting the task ID back and
 * having to poll separately.
 */

import { spawn } from "child_process";
import { dispatchRevenueOsAgentToHermes } from "./hermes-agent-executor";
import { kanbanShow, type HermesTask, type TaskEvent } from "./hermes-kanban-service";

// ─── SSE event types ─────────────────────────────────────────────────────────

export type DispatchSSEEvent =
  | { type: "init"; hermesTaskId: string; runId: string; task: HermesTask }
  | { type: "heartbeat"; taskId: string; note?: string; timestamp: number }
  | { type: "log"; taskId: string; line: string; timestamp: number }
  | { type: "done"; taskId: string; summary?: string; timestamp: number }
  | { type: "blocked"; taskId: string; reason?: string; timestamp: number }
  | { type: "failed"; taskId: string; error?: string; timestamp: number };

// ─── Tail subprocess parser ────────────────────────────────────────────────────

/**
 * Parse a line from `hermes kanban log --follow <taskId>` (or `tail`).
 * The Hermes CLI emits structured text lines; we try to detect event types
 * from the content.
 *
 * Expected line shapes (not guaranteed — Hermes may vary):
 *   [heartbeat] <note>
 *   <timestamp> <message>
 *   TASK COMPLETE: <summary>
 *   TASK BLOCKED: <reason>
 *   TASK FAILED: <error>
 *   <raw worker output>
 */
function parseTailLine(taskId: string, line: string): DispatchSSEEvent | null {
  const ts = Date.now();
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Heartbeat markers
  if (
    trimmed.startsWith("[heartbeat]") ||
    trimmed.startsWith("[HB]") ||
    trimmed.startsWith("heartbeat")
  ) {
    const note = trimmed.replace(/^\[heartbeat\]|\[HB\]|heartbeat\s*/i, "").trim() || undefined;
    return { type: "heartbeat", taskId, note, timestamp: ts };
  }

  // Terminal states
  if (trimmed.startsWith("TASK COMPLETE") || trimmed.startsWith("COMPLETE")) {
    const summary = trimmed.replace(/^TASK\s*COMPLETE:\s*/i, "").trim() || undefined;
    return { type: "done", taskId, summary, timestamp: ts };
  }
  if (trimmed.startsWith("TASK BLOCKED") || trimmed.startsWith("BLOCKED")) {
    const reason = trimmed.replace(/^TASK\s*BLOCKED:\s*/i, "").trim() || undefined;
    return { type: "blocked", taskId, reason, timestamp: ts };
  }
  if (trimmed.startsWith("TASK FAILED") || trimmed.startsWith("FAILED")) {
    const error = trimmed.replace(/^TASK\s*FAILED:\s*/i, "").trim() || undefined;
    return { type: "failed", taskId, error, timestamp: ts };
  }

  // JSON event lines (if Hermes outputs JSON on a separate line)
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.event === "heartbeat") {
        return { type: "heartbeat", taskId, note: parsed.note, timestamp: ts };
      }
      if (parsed.event === "log") {
        return { type: "log", taskId, line: parsed.message ?? trimmed, timestamp: ts };
      }
    } catch {
      // Not JSON — fall through to log
    }
  }

  // Generic log line
  return { type: "log", taskId, line: trimmed, timestamp: ts };
}

// ─── Main SSE dispatch function ───────────────────────────────────────────────

export interface DispatchWithSSEOptions {
  agentId: string;
  taskTitle: string;
  taskBody: string;
  parentHermesTaskIds?: string[];
  tenantId?: string;
  maxRuntimeSeconds?: number;
}

/**
 * Dispatch a Revenue OS agent to Hermes and stream SSE events back to the caller.
 *
 * Flow:
 * 1. Call dispatchRevenueOsAgentToHermes (creates Hermes task + Revenue OS run record)
 * 2. Spawn `hermes kanban log --follow <taskId>` as a subprocess
 * 3. Parse output lines → SSE events (heartbeat, log, done, blocked, failed)
 * 4. Yield initial "init" event with task metadata immediately
 * 5. When task reaches a terminal state (done/blocked/failed), close the stream
 *
 * Returns a Response with Content-Type: text/event-stream
 */
export async function dispatchRevenueOsAgentWithSSE(
  opts: DispatchWithSSEOptions
): Promise<Response> {
  // ── Step 1: Create the Hermes task ──────────────────────────────────────────
  const { hermesTaskId, runId } = await dispatchRevenueOsAgentToHermes({
    agentId: opts.agentId,
    taskTitle: opts.taskTitle,
    taskBody: opts.taskBody,
    parentHermesTaskIds: opts.parentHermesTaskIds,
    tenantId: opts.tenantId,
    maxRuntimeSeconds: opts.maxRuntimeSeconds,
  });

  const tenantId = opts.tenantId ?? "default";

  // ── Step 2: Fetch initial task state ──────────────────────────────────────
  const task = await kanbanShow(hermesTaskId);

  const enc = new TextEncoder();

  const sse = (event: DispatchSSEEvent): Uint8Array => {
    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    return enc.encode(data);
  };

  // ── Step 3: Build the SSE stream ───────────────────────────────────────────
  const stream = new ReadableStream({
    start(controller) {
      // Send init event immediately
      controller.enqueue(
        sse({
          type: "init",
          hermesTaskId,
          runId,
          task: task ?? {
            id: hermesTaskId,
            title: opts.taskTitle,
            body: opts.taskBody,
            assignee: null,
            status: "ready",
            priority: 50,
            created_by: null,
            created_at: Date.now(),
            started_at: null,
            completed_at: null,
            workspace_kind: "scratch",
            workspace_path: null,
            tenant: tenantId,
            max_runtime_seconds: opts.maxRuntimeSeconds ?? null,
            last_heartbeat_at: null,
            consecutive_failures: 0,
            skills: [],
            max_retries: null,
          },
        })
      );

      // ── Step 4: Spawn tail subprocess ────────────────────────────────────
      const tailProc = spawn("hermes", ["kanban", "log", "--follow", hermesTaskId], {
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          tailProc.kill("SIGTERM");
        } catch {
          // ignore if already dead
        }
        try {
          controller.close();
        } catch {
          // ignore if already closed
        }
      };

      // Parse stdout lines → SSE events
      let buffer = "";
      tailProc.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete last line in buffer

        for (const rawLine of lines) {
          const event = parseTailLine(hermesTaskId, rawLine);
          if (!event) continue;

          try {
            controller.enqueue(sse(event));
          } catch {
            // Stream may already be closed — non-fatal
          }

          // Terminal states close the stream
          if (event.type === "done" || event.type === "blocked" || event.type === "failed") {
            setTimeout(close, 500); // small delay to let final bytes flush
          }
        }
      });

      tailProc.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (!line) return;
        try {
          controller.enqueue(sse({ type: "log", taskId: hermesTaskId, line: `[stderr] ${line}`, timestamp: Date.now() }));
        } catch {
          // non-fatal
        }
      });

      tailProc.on("error", (err) => {
        try {
          controller.enqueue(sse({ type: "failed", taskId: hermesTaskId, error: err.message, timestamp: Date.now() }));
        } catch {
          // non-fatal
        }
        close();
      });

      tailProc.on("close", (code) => {
        // If the process exited non-zero without a terminal event, emit failed
        if (code !== 0 && !closed) {
          try {
            controller.enqueue(sse({ type: "failed", taskId: hermesTaskId, error: `Worker exited with code ${code}`, timestamp: Date.now() }));
          } catch {
            // non-fatal
          }
        }
        close();
      });

      // Safety timeout: if task takes longer than maxRuntimeSeconds + 30s buffer,
      // force-close with a failed event
      const timeoutMs = ((opts.maxRuntimeSeconds ?? 300) + 30) * 1000;
      const timeoutHandle = setTimeout(() => {
        if (!closed) {
          try {
            controller.enqueue(sse({ type: "failed", taskId: hermesTaskId, error: "SSE stream timeout", timestamp: Date.now() }));
          } catch {
            // non-fatal
          }
          close();
        }
      }, timeoutMs);

      // Clean up timeout on close
      tailProc.on("close", () => {
        clearTimeout(timeoutHandle);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering for SSE
    },
  });
}
