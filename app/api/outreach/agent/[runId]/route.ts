import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const OUTREACH_AGENT_ID = "01OUTREACH000000000000000";
const OUTPUT_DIR = join(homedir(), ".tmp", "outreach-runs");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const tenantId = getTenantId();
  const { runId } = await params;

  const run = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId), eq(agentRuns.agentId, OUTREACH_AGENT_ID)))
    .get();

  if (!run) return Response.json({ error: "Not found" }, { status: 404 });

  // If still running, stream partial output from file
  let liveOutput: string | null = null;
  if (run.status === "running") {
    const outputPath = join(OUTPUT_DIR, `${runId}.txt`);
    if (existsSync(outputPath)) {
      try { liveOutput = readFileSync(outputPath, "utf-8"); } catch { /* ignore */ }
    }
  }

  return Response.json({ ...run, liveOutput });
}
