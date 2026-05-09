import { NextRequest } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/db";
import { copilotConversations, copilotMessages, desks } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";

/**
 * POST /api/copilot/cron-ingest
 *
 * Ingest a cron job result as an assistant message in the desk's
 * latest copilot conversation. Called by Hermes cron jobs after
 * execution to surface their output in the Revenue OS UI.
 *
 * Body:
 *   - deskSlug: string (e.g. "scout", "outreach", "steward")
 *   - title: string (human-readable cron job name)
 *   - content: string (the cron job output/summary)
 *   - metadata?: Record<string, any> (optional structured data)
 */
export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();

  const { deskSlug, title, content, metadata } = body;

  if (!deskSlug || !title || !content) {
    return Response.json(
      { error: "deskSlug, title, and content are required" },
      { status: 400 },
    );
  }

  // Find the desk
  const desk = db
    .select()
    .from(desks)
    .where(eq(desks.slug, deskSlug))
    .get();

  if (!desk) {
    return Response.json({ error: `Desk "${deskSlug}" not found` }, { status: 404 });
  }

  // Find or create a conversation for this desk's cron output
  let conversation = db
    .select()
    .from(copilotConversations)
    .where(
      and(
        eq(copilotConversations.tenantId, tenantId),
        eq(copilotConversations.deskId, desk.id),
      ),
    )
    .orderBy(desc(copilotConversations.updatedAt))
    .limit(1)
    .get();

  if (!conversation) {
    const id = ulid();
    db.insert(copilotConversations)
      .values({
        id,
        tenantId,
        deskId: desk.id,
        ownerAgentId: "01CHIEFOFSTAFF000000000000",
        title: `${desk.name} — Cron Output`,
      })
      .run();
    conversation = { id, tenantId, deskId: desk.id, ownerAgentId: "01CHIEFOFSTAFF000000000000", title: `${desk.name} — Cron Output`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  // Format the cron message with metadata
  const timestamp = new Date().toISOString();
  let formattedContent = `**[Cron: ${title}]** ${timestamp}\n\n${content}`;

  if (metadata) {
    formattedContent += `\n\n<details><summary>Structured Data</summary>\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n</details>`;
  }

  // Insert as assistant message
  db.insert(copilotMessages)
    .values({
      id: ulid(),
      conversationId: conversation.id,
      role: "assistant",
      content: formattedContent,
    })
    .run();

  // Update conversation timestamp
  db.update(copilotConversations)
    .set({ updatedAt: timestamp })
    .where(eq(copilotConversations.id, conversation.id))
    .run();

  return Response.json({
    ok: true,
    conversationId: conversation.id,
    deskId: desk.id,
  });
}
