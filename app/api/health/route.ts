import { db } from "@/db";
import { agentRuns, agents } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    // Check DB connection
    db.run(sql`SELECT 1`);

    // Clean up stale runs (stuck in "running" for >10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const staleRuns = db
      .select({ id: agentRuns.id, agentId: agentRuns.agentId })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.status, "running"),
          lt(agentRuns.startedAt, tenMinutesAgo)
        )
      )
      .all();

    for (const run of staleRuns) {
      db.update(agentRuns)
        .set({
          status: "failed",
          error: "Cleaned up: stuck in running state for >10 minutes",
          completedAt: new Date().toISOString(),
        })
        .where(eq(agentRuns.id, run.id))
        .run();

      // Reset agent status too
      db.update(agents)
        .set({ status: "idle" })
        .where(eq(agents.id, run.agentId))
        .run();

      console.log(JSON.stringify({
        event: "stale_run_cleaned",
        runId: run.id,
        agentId: run.agentId,
        timestamp: new Date().toISOString(),
      }));
    }

    return Response.json({
      status: "ok",
      db: "connected",
      staleRunsCleaned: staleRuns.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
