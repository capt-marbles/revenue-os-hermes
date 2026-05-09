import { db } from "@/db";
import { autopilots, autopilotRuns } from "@/db/schema";
import { eq, and, lte, isNull, or } from "drizzle-orm";
import { computeNextRun } from "./cron";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const AGENT_PORTS: Record<string, number> = {
  scout: 8643,
  outreach: 8644,
  steward: 8645,
  marketing: 8646,
  "sales-engineering": 8647,
  "chief-of-staff": 8648,
  leo: 8649,
};

async function fireAgent(agentSlug: string, prompt: string, timeoutMs = 120_000): Promise<string> {
  const port = AGENT_PORTS[agentSlug];
  if (!port) throw new Error(`Unknown agent: ${agentSlug}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [{ role: "user", content: prompt }],
        stream: true,
        profile: agentSlug,
      }),
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim().startsWith("data: ")) continue;
        const payload = line.trim().slice(6);
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) content += chunk;
        } catch { /* skip */ }
      }
    }

    return content || "(no output)";
  } finally {
    clearTimeout(timer);
  }
}

async function fireClaudeCode(agentSlug: string, prompt: string, timeoutMs = 300_000): Promise<string> {
  const agentDir = path.join(homedir(), ".agents", agentSlug);

  const { stdout } = await execFileAsync("claude", [
    "--print", prompt,
    "--allowedTools", "Bash,Read,Write,WebFetch,WebSearch",
    "--permission-mode", "bypassPermissions",
    "--output-format", "json",
    "--model", "claude-sonnet-4-6",
    "--max-turns", "30",
  ], {
    cwd: agentDir,
    timeout: timeoutMs,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });

  try {
    const result = JSON.parse(stdout);
    return result.result ?? result.content ?? stdout;
  } catch {
    return stdout || "(no output)";
  }
}

export async function runDueAutopilots(tenantId: string): Promise<void> {
  const now = new Date().toISOString();

  const due = db
    .select()
    .from(autopilots)
    .where(
      and(
        eq(autopilots.tenantId, tenantId),
        eq(autopilots.enabled, 1),
        or(isNull(autopilots.nextRunAt), lte(autopilots.nextRunAt, now))
      )
    )
    .all();

  for (const autopilot of due) {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    // Mark as running
    db.insert(autopilotRuns).values({
      id: runId,
      tenantId,
      autopilotId: autopilot.id,
      status: "running",
      trigger: "scheduled",
      prompt: autopilot.prompt,
      startedAt,
      createdAt: startedAt,
    }).run();

    db.update(autopilots)
      .set({ lastRunStatus: "running", updatedAt: startedAt })
      .where(eq(autopilots.id, autopilot.id))
      .run();

    try {
      const fire = autopilot.harness === "claude-code" ? fireClaudeCode : fireAgent;
      const output = await fire(autopilot.agentSlug, autopilot.prompt);
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const nextRunAt = computeNextRun(autopilot.schedule, new Date(completedAt)).toISOString();

      db.update(autopilotRuns)
        .set({ status: "success", output, completedAt, durationMs })
        .where(eq(autopilotRuns.id, runId))
        .run();

      db.update(autopilots)
        .set({ lastRunAt: completedAt, lastRunStatus: "success", nextRunAt, updatedAt: completedAt })
        .where(eq(autopilots.id, autopilot.id))
        .run();

      console.log(`[autopilot] ${autopilot.name} → success (${durationMs}ms)`);
    } catch (err) {
      const completedAt = new Date().toISOString();
      const error = err instanceof Error ? err.message : String(err);
      const nextRunAt = computeNextRun(autopilot.schedule, new Date(completedAt)).toISOString();

      db.update(autopilotRuns)
        .set({ status: "failed", error, completedAt })
        .where(eq(autopilotRuns.id, runId))
        .run();

      db.update(autopilots)
        .set({ lastRunAt: completedAt, lastRunStatus: "failed", nextRunAt, updatedAt: completedAt })
        .where(eq(autopilots.id, autopilot.id))
        .run();

      console.error(`[autopilot] ${autopilot.name} → failed: ${error}`);
    }
  }
}

export async function triggerAutopilot(autopilotId: string, tenantId: string): Promise<string> {
  const autopilot = db.select().from(autopilots)
    .where(and(eq(autopilots.id, autopilotId), eq(autopilots.tenantId, tenantId)))
    .get();

  if (!autopilot) throw new Error("Autopilot not found");

  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  db.insert(autopilotRuns).values({
    id: runId,
    tenantId,
    autopilotId,
    status: "running",
    trigger: "manual",
    prompt: autopilot.prompt,
    startedAt,
    createdAt: startedAt,
  }).run();

  db.update(autopilots)
    .set({ lastRunStatus: "running", updatedAt: startedAt })
    .where(eq(autopilots.id, autopilotId))
    .run();

  try {
    const fire = autopilot.harness === "claude-code" ? fireClaudeCode : fireAgent;
    const output = await fire(autopilot.agentSlug, autopilot.prompt);
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    const nextRunAt = computeNextRun(autopilot.schedule, new Date(completedAt)).toISOString();

    db.update(autopilotRuns)
      .set({ status: "success", output, completedAt, durationMs })
      .where(eq(autopilotRuns.id, runId))
      .run();

    db.update(autopilots)
      .set({ lastRunAt: completedAt, lastRunStatus: "success", nextRunAt, updatedAt: completedAt })
      .where(eq(autopilots.id, autopilotId))
      .run();

    return runId;
  } catch (err) {
    const completedAt = new Date().toISOString();
    const error = err instanceof Error ? err.message : String(err);

    db.update(autopilotRuns)
      .set({ status: "failed", error, completedAt })
      .where(eq(autopilotRuns.id, runId))
      .run();

    db.update(autopilots)
      .set({ lastRunAt: completedAt, lastRunStatus: "failed", updatedAt: completedAt })
      .where(eq(autopilots.id, autopilotId))
      .run();

    throw err;
  }
}
