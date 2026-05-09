import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/db";
import { copilotConversations, copilotMessages } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import { getChiefOfStaff } from "@/lib/chief-of-staff";
import { getRuntime } from "@/lib/runtime";
import { assembleBriefing } from "./copilot-briefing";
import { buildCopilotPrompt } from "./copilot-prompt";

export async function copilotChatSync(
  conversationId: string,
  message: string,
): Promise<string> {
  const tenantId = getTenantId();
  const chiefOfStaff = getChiefOfStaff();

  db.insert(copilotMessages)
    .values({
      id: ulid(),
      conversationId,
      role: "user",
      content: message,
    })
    .run();

  const briefing = await assembleBriefing();

  const history = db
    .select()
    .from(copilotMessages)
    .where(eq(copilotMessages.conversationId, conversationId))
    .orderBy(asc(copilotMessages.createdAt))
    .all()
    .slice(-20);

  const historyBlock = history
    .map((m) => `${m.role === "user" ? "Operator" : "Co-Pilot"}: ${m.content}`)
    .join("\n\n");

  const fullPrompt = [
    buildCopilotPrompt(null),
    "",
    "---",
    "",
    briefing.markdown,
    "",
    "---",
    "",
    "## Conversation",
    historyBlock,
    "",
    `Respond as the ${chiefOfStaff?.name || "Chief of Staff"}. Be concise, data-driven, and opinionated.`,
  ].join("\n");

  const conversation = db
    .select()
    .from(copilotConversations)
    .where(
      and(
        eq(copilotConversations.id, conversationId),
        eq(copilotConversations.tenantId, tenantId),
      ),
    )
    .get();

  if (conversation && !conversation.title) {
    const title = `Telegram: ${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`;
    db.update(copilotConversations)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(copilotConversations.id, conversationId))
      .run();
  } else {
    db.update(copilotConversations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(copilotConversations.id, conversationId))
      .run();
  }

  const runtime = getRuntime();
  const result = await runtime.execute(fullPrompt, { model: "sonnet" });
  const response = result.stdout.trim() || "Sorry, I couldn't generate a response.";

  db.insert(copilotMessages)
    .values({
      id: ulid(),
      conversationId,
      role: "assistant",
      content: response,
    })
    .run();

  return response;
}

export function getOrCreateTelegramConversation(chatId: number | string): string {
  const tenantId = getTenantId();
  const chiefOfStaff = getChiefOfStaff();
  const title = `telegram:${chatId}`;

  const existing = db
    .select()
    .from(copilotConversations)
    .where(eq(copilotConversations.title, title))
    .get();

  if (existing) return existing.id;

  const id = ulid();
  db.insert(copilotConversations)
    .values({ id, tenantId, ownerAgentId: chiefOfStaff?.id || null, title })
    .run();

  return id;
}

export function getOrCreateSystemConversation(title: string): string {
  const tenantId = getTenantId();
  const chiefOfStaff = getChiefOfStaff();

  const existing = db
    .select()
    .from(copilotConversations)
    .where(
      and(
        eq(copilotConversations.tenantId, tenantId),
        eq(copilotConversations.title, title),
      ),
    )
    .get();

  if (existing) return existing.id;

  const id = ulid();
  db.insert(copilotConversations)
    .values({ id, tenantId, ownerAgentId: chiefOfStaff?.id || null, title })
    .run();

  return id;
}
