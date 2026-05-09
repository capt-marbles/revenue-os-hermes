import { NextRequest } from "next/server";
import { db } from "@/db";
import { copilotActionDecisions, copilotConversations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const conversationId = request.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }

  const conversation = db
    .select()
    .from(copilotConversations)
    .where(and(eq(copilotConversations.id, conversationId), eq(copilotConversations.tenantId, tenantId)))
    .get();

  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const decisions = db
    .select()
    .from(copilotActionDecisions)
    .where(
      and(
        eq(copilotActionDecisions.tenantId, tenantId),
        eq(copilotActionDecisions.conversationId, conversationId),
      ),
    )
    .all();

  return Response.json(decisions);
}

const upsertDecisionSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  actionKey: z.string().min(1),
  status: z.enum(["approved", "dismissed"]),
  resultMessage: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = upsertDecisionSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const existing = db
    .select()
    .from(copilotActionDecisions)
    .where(
      and(
        eq(copilotActionDecisions.tenantId, tenantId),
        eq(copilotActionDecisions.messageId, data.messageId),
        eq(copilotActionDecisions.actionKey, data.actionKey),
      ),
    )
    .get();

  if (existing) {
    db.update(copilotActionDecisions)
      .set({
        status: data.status,
        resultMessage: data.resultMessage || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(copilotActionDecisions.id, existing.id))
      .run();

    return Response.json({ ...existing, ...data });
  }

  const decision = {
    id: ulid(),
    tenantId,
    conversationId: data.conversationId,
    messageId: data.messageId,
    actionKey: data.actionKey,
    status: data.status,
    resultMessage: data.resultMessage || null,
  };

  db.insert(copilotActionDecisions).values(decision).run();
  return Response.json(decision, { status: 201 });
}
