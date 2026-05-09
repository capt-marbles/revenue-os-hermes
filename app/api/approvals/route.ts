import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createApproval,
  getPendingApprovals,
} from "@/lib/approval-store";
import { requireAuth } from "@/lib/auth";

/**
 * Approval API for Revenue OS.
 *
 * Endpoints:
 *   GET  /api/approvals?deskId=scout&status=pending  — list approvals
 *   POST /api/approvals                               — create approval request
 *
 * Per-approval resolution is at /api/approvals/[id] (PATCH).
 */

// ---- GET: list approvals ----

export async function GET(request: NextRequest) {
  const deskId = request.nextUrl.searchParams.get("deskId");
  const status = request.nextUrl.searchParams.get("status") || "pending";

  if (status === "pending") {
    const approvals = getPendingApprovals(deskId || undefined);
    return Response.json({ approvals });
  }

  // For "all" status, we'd need a full store scan — for now just return pending
  const approvals = getPendingApprovals(deskId || undefined);
  return Response.json({ approvals });
}

// ---- POST: create approval request ----

const createSchema = z.object({
  deskId: z.string().min(1),
  sessionKey: z.string().min(1),
  command: z.string().min(1),
  description: z.string().min(1),
  patternKey: z.string().optional(),
  patternKeys: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const approval = createApproval(parsed.data);
  return Response.json({ approval }, { status: 201 });
}
