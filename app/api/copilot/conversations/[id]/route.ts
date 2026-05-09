import { NextRequest } from "next/server";
import { db } from "@/db";
import { copilotActionDecisions, copilotConversations, copilotMessages } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const conversation = db
    .select()
    .from(copilotConversations)
    .where(and(eq(copilotConversations.id, id), eq(copilotConversations.tenantId, tenantId)))
    .get();

  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = db
    .select()
    .from(copilotMessages)
    .where(eq(copilotMessages.conversationId, id))
    .orderBy(asc(copilotMessages.createdAt))
    .all();

  const actionDecisions = db
    .select()
    .from(copilotActionDecisions)
    .where(
      and(
        eq(copilotActionDecisions.tenantId, tenantId),
        eq(copilotActionDecisions.conversationId, id),
      )
    )
    .all();

  return Response.json({ ...conversation, messages, actionDecisions });
}
