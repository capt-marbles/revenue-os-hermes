import { NextRequest } from "next/server";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { copilotConversations, copilotMessages, desks } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";

/**
 * POST /api/copilot/agent-briefing
 *
 * Called by the CoS to request a fresh briefing from a specific desk agent.
 * Returns the last N assistant messages from that agent's conversation.
 *
 * Body: { deskSlug: string, limit?: number }
 */
export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const { deskSlug, limit = 3 } = body as { deskSlug?: string; limit?: number };

  if (!deskSlug) {
    return Response.json({ error: "deskSlug is required" }, { status: 400 });
  }

  // Find the desk
  const desk = db
    .select()
    .from(desks)
    .where(and(eq(desks.tenantId, tenantId), eq(desks.slug, deskSlug)))
    .get();

  if (!desk) {
    return Response.json({ error: `Desk "${deskSlug}" not found` }, { status: 404 });
  }

  // Find the most recent conversation for this desk
  const conversation = db
    .select()
    .from(copilotConversations)
    .where(and(eq(copilotConversations.tenantId, tenantId), eq(copilotConversations.deskId, desk.id)))
    .orderBy(desc(copilotConversations.updatedAt))
    .limit(1)
    .get();

  if (!conversation) {
    return Response.json({
      desk: desk.name,
      slug: desk.slug,
      messages: [],
      summary: `No conversation found for ${desk.name}.`,
    });
  }

  // Get the last N assistant messages
  const messages = db
    .select({ content: copilotMessages.content, createdAt: copilotMessages.createdAt })
    .from(copilotMessages)
    .where(
      and(
        eq(copilotMessages.conversationId, conversation.id),
        eq(copilotMessages.role, "assistant"),
      ),
    )
    .orderBy(desc(copilotMessages.createdAt))
    .limit(limit)
    .all();

  // Reverse so they're chronological
  messages.reverse();

  const totalMessages = db
    .select({ count: sql<number>`count(*)` })
    .from(copilotMessages)
    .where(eq(copilotMessages.conversationId, conversation.id))
    .get();

  return Response.json({
    desk: desk.name,
    slug: desk.slug,
    conversationId: conversation.id,
    totalMessages: totalMessages?.count ?? 0,
    messages: messages.map((m) => ({
      content: m.content,
      createdAt: m.createdAt,
    })),
    summary: messages.length > 0
      ? `Retrieved ${messages.length} recent messages from ${desk.name} (${totalMessages?.count ?? 0} total).`
      : `No assistant messages found for ${desk.name}.`,
  });
}

/**
 * GET /api/copilot/agent-briefing
 * Returns all available desks for the CoS to query.
 */
export async function GET() {
  const tenantId = getTenantId();
  const deskList = db
    .select({ id: desks.id, name: desks.name, slug: desks.slug })
    .from(desks)
    .where(eq(desks.tenantId, tenantId))
    .all();

  return Response.json({ desks: deskList });
}
