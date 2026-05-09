import { NextRequest } from "next/server";
import { z } from "zod";
import {
  resolveApproval as resolveApprovalInStore,
  revertApproval,
  resolveViaHermes,
  getProfileForDesk,
} from "@/lib/approval-store";
import { requireAuth } from "@/lib/auth";

/**
 * PATCH /api/approvals/[id] — resolve a specific approval.
 */

const resolveSchema = z.object({
  choice: z.enum(["once", "session", "always", "deny"]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request);
  if (auth) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = resolveSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { choice } = parsed.data;
  const approval = resolveApprovalInStore(id, choice);

  if (!approval) {
    return Response.json({ error: "Approval not found or already resolved" }, { status: 404 });
  }

  // Resolve via Hermes gateway — send the /approve or /deny command
  const profile = getProfileForDesk(approval.deskId);
  const hermesResolved = await resolveViaHermes(approval.sessionKey, choice, profile);

  if (!hermesResolved) {
    revertApproval(id);
    return Response.json(
      { error: "Failed to resolve approval in Hermes" },
      { status: 502 },
    );
  }

  return Response.json({ approval, hermesResolved });
}
