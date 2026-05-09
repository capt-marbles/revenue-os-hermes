import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runPipelineCron } from "@/lib/scheduler/pipeline-cron";

/**
 * GET /api/scheduler/pipeline-pulse
 *
 * Cron endpoint — checks for active cron triggers targeting specialist agents,
 * finds opportunities needing attention, and queues agent runs.
 *
 * Call with ?token=OPERATOR_TOKEN or via same-origin request.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  try {
    const result = runPipelineCron();

    return Response.json({
      ok: true,
      triggered: result.triggered,
      details: result.details,
      errors: result.errors.length > 0 ? result.errors : undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
