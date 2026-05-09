import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { delegateToAgent } from "@/lib/copilot/delegate";
import { z } from "zod";

const VALID_SLUGS = ["scout", "outreach", "steward"] as const;

const delegateSchema = z.object({
  agentSlug: z.enum(VALID_SLUGS),
  task: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]).optional(),
  autoApprove: z.boolean().optional().default(false),
});

/**
 * POST /api/copilot/delegate
 *
 * Lets the CoS create a task assigned to a specialist agent and optionally
 * trigger immediate execution.
 *
 * Body: { agentSlug: "scout"|"outreach"|"steward", task: string, priority?: "high"|"medium"|"low", autoApprove?: boolean }
 */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = delegateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { agentSlug, task, priority, autoApprove } = parsed.data;

  const result = delegateToAgent(
    process.env.DEFAULT_TENANT_ID || "01JDEFAULT0000000000000000",
    agentSlug,
    task,
    { priority, autoApprove, source: "copilot" },
  );

  if (!result.success) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({
    taskId: result.taskId,
    runId: result.runId,
    agentSlug,
    autoApprove,
    message: autoApprove
      ? `Task delegated to ${agentSlug} and queued for execution`
      : `Task delegated to ${agentSlug} — awaiting approval`,
  });
}
