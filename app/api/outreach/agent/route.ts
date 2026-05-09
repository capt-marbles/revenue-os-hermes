import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { createWriteStream, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

const OUTREACH_AGENT_ID = "01OUTREACH000000000000000";
const AGENT_DIR = join(homedir(), ".agents", "outreach");
const OUTPUT_DIR = join(homedir(), ".tmp", "outreach-runs");

function getOutputPath(runId: string) {
  return join(OUTPUT_DIR, `${runId}.txt`);
}

function extractText(line: string): string | null {
  try {
    const obj = JSON.parse(line);
    // assistant message with text content
    if (obj.type === "assistant") {
      const parts = obj.message?.content ?? [];
      return parts
        .filter((p: { type: string }) => p.type === "text")
        .map((p: { text: string }) => p.text)
        .join("");
    }
    // tool use — show what tool is being called
    if (obj.type === "tool_use" || obj.message?.content?.some?.((p: { type: string }) => p.type === "tool_use")) {
      const tools = (obj.message?.content ?? []).filter((p: { type: string }) => p.type === "tool_use");
      if (tools.length) return `[${tools.map((t: { name: string }) => t.name).join(", ")}]`;
    }
    // final result
    if (obj.type === "result") {
      return obj.result ?? null;
    }
  } catch { /* not JSON */ }
  return null;
}

export async function GET() {
  const tenantId = getTenantId();

  const runs = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.tenantId, tenantId), eq(agentRuns.agentId, OUTREACH_AGENT_ID)))
    .orderBy(desc(agentRuns.createdAt))
    .limit(10)
    .all();

  return Response.json(runs);
}

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();

  let prompt = "Draft outreach emails for today's leads in ~/outreach/. Check ~/.hermes/processed_leads.json first to avoid duplicates.";
  try {
    const body = await request.json();
    if (body.prompt?.trim()) prompt = body.prompt.trim();
  } catch { /* use default */ }

  const runId = randomUUID();
  const now = new Date().toISOString();

  db.insert(agentRuns).values({
    id: runId,
    tenantId,
    agentId: OUTREACH_AGENT_ID,
    status: "running",
    trigger: "manual",
    input: prompt,
    startedAt: now,
    createdAt: now,
  }).run();

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputPath = getOutputPath(runId);
  const outStream = createWriteStream(outputPath, { flags: "a" });

  const proc = spawn("claude", [
    "--print", prompt,
    "--allowedTools", "Bash,Read,Write,WebFetch,WebSearch",
    "--permission-mode", "bypassPermissions",
    "--output-format", "stream-json",
    "--model", "claude-sonnet-4-6",
    "--max-turns", "40",
  ], {
    cwd: AGENT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Parse stream-json line by line, write readable text to output file
  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const text = extractText(line);
    if (text) outStream.write(text + "\n");
  });

  // stderr goes straight through (errors, warnings)
  proc.stderr.on("data", (chunk: Buffer) => {
    outStream.write(chunk.toString());
  });

  proc.on("close", (code) => {
    rl.close();
    outStream.end();

    const { readFileSync } = require("fs");
    let output = "(no output)";
    try { output = readFileSync(outputPath, "utf-8").trim() || "(no output)"; } catch { /* ignore */ }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(now).getTime();

    db.update(agentRuns)
      .set({
        status: code === 0 ? "success" : "failed",
        output,
        completedAt,
        durationMs,
        error: code !== 0 ? `Process exited with code ${code}` : null,
      })
      .where(eq(agentRuns.id, runId))
      .run();
  });

  proc.on("error", (err) => {
    outStream.end();
    db.update(agentRuns)
      .set({ status: "failed", error: err.message, completedAt: new Date().toISOString() })
      .where(eq(agentRuns.id, runId))
      .run();
  });

  return Response.json({ runId }, { status: 202 });
}
