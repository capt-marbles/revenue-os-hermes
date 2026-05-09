import { NextRequest } from "next/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/db";
import { agents, copilotConversations, desks } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import { getChiefOfStaff } from "@/lib/chief-of-staff";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const agentSlug = request.nextUrl.searchParams.get("agentSlug");
  let agentId = request.nextUrl.searchParams.get("agentId");

  if (agentSlug && !agentId) {
    const agent = db
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.slug, agentSlug)))
      .get();
    agentId = agent?.id ?? null;
  }

  const deskSlug = request.nextUrl.searchParams.get("deskId");

  let deskId: string | null = null;
  if (deskSlug) {
    const desk =
      db
        .select()
        .from(desks)
        .where(and(eq(desks.tenantId, tenantId), eq(desks.slug, deskSlug)))
        .get() ||
      db
        .select()
        .from(desks)
        .where(and(eq(desks.id, deskSlug), eq(desks.tenantId, tenantId)))
        .get();
    deskId = desk?.id ?? null;
  }

  const baseSelect = db
    .select({
      id: copilotConversations.id,
      title: copilotConversations.title,
      deskId: copilotConversations.deskId,
      createdAt: copilotConversations.createdAt,
      updatedAt: copilotConversations.updatedAt,
      messageCount:
        sql<number>`(select count(*) from copilot_messages cm where cm.conversation_id = copilot_conversations.id)`.as("messageCount"),
    })
    .from(copilotConversations);

  const global = request.nextUrl.searchParams.get("global");

  // When filtering by agentId (e.g. chief-of-staff), also resolve that agent's own
  // desk so conversations from /desk/chief-of-staff/copilot are included.
  let agentOwnDeskId: string | null = null;
  if (agentId) {
    const agentRow = db.select({ slug: agents.slug }).from(agents).where(eq(agents.id, agentId)).get();
    if (agentRow?.slug) {
      const ownDesk = db.select({ id: desks.id }).from(desks)
        .where(and(eq(desks.tenantId, tenantId), eq(desks.slug, agentRow.slug)))
        .get();
      agentOwnDeskId = ownDesk?.id ?? null;
    }
  }

  const conversations = agentId
    ? baseSelect
        .where(
          and(
            eq(copilotConversations.tenantId, tenantId),
            eq(copilotConversations.ownerAgentId, agentId),
            // Allow deskId=null (global CoS) OR deskId matching the agent's own desk.
            // Exclude conversations scoped to other desks (Steward, Scout, etc.)
            // that incorrectly inherited this ownerAgentId.
            agentOwnDeskId
              ? or(isNull(copilotConversations.deskId), eq(copilotConversations.deskId, agentOwnDeskId))
              : isNull(copilotConversations.deskId),
          ),
        )
        .orderBy(desc(copilotConversations.updatedAt))
        .all()
    : deskId
      ? baseSelect
          .where(
            and(
              eq(copilotConversations.tenantId, tenantId),
              eq(copilotConversations.deskId, deskId),
            ),
          )
          .orderBy(desc(copilotConversations.updatedAt))
          .all()
      : global
        ? baseSelect
            .where(
              and(
                eq(copilotConversations.tenantId, tenantId),
                isNull(copilotConversations.deskId),
                isNull(copilotConversations.ownerAgentId),
              ),
            )
            .orderBy(desc(copilotConversations.updatedAt))
            .all()
        : baseSelect
            .where(eq(copilotConversations.tenantId, tenantId))
            .orderBy(desc(copilotConversations.updatedAt))
            .all();

  return Response.json(conversations);
}

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const chiefOfStaff = getChiefOfStaff();

  let deskId: string | null = null;
  if (body.deskId) {
    const desk =
      db
        .select()
        .from(desks)
        .where(and(eq(desks.tenantId, tenantId), eq(desks.slug, body.deskId)))
        .get() ||
      db
        .select()
        .from(desks)
        .where(and(eq(desks.id, body.deskId), eq(desks.tenantId, tenantId)))
        .get();
    deskId = desk?.id ?? null;
  }

  // Only assign the CoS agent as owner for non-desk conversations.
  // Desk conversations are scoped by deskId alone; mixing ownerAgentId there
  // caused all desk conversations to appear in the CoS sidebar.
  const ownerAgentId: string | null = body.ownerAgentId ?? (deskId ? null : chiefOfStaff?.id ?? null);

  const wantsUntitledConversation = !body.title;
  if (wantsUntitledConversation) {
    const existingEmptyConversation = db
      .select({
        id: copilotConversations.id,
        tenantId: copilotConversations.tenantId,
        deskId: copilotConversations.deskId,
        ownerAgentId: copilotConversations.ownerAgentId,
        title: copilotConversations.title,
        createdAt: copilotConversations.createdAt,
        updatedAt: copilotConversations.updatedAt,
      })
      .from(copilotConversations)
      .where(
        and(
          eq(copilotConversations.tenantId, tenantId),
          isNull(copilotConversations.title),
          ownerAgentId
            ? eq(copilotConversations.ownerAgentId, ownerAgentId)
            : deskId
              ? eq(copilotConversations.deskId, deskId)
              : isNull(copilotConversations.deskId),
          sql`(select count(*) from copilot_messages where conversation_id = ${copilotConversations.id}) = 0`,
        ),
      )
      .orderBy(desc(copilotConversations.updatedAt))
      .get();

    if (existingEmptyConversation) {
      return Response.json(existingEmptyConversation, { status: 200 });
    }
  }

  const conversation = {
    id: ulid(),
    tenantId,
    deskId,
    ownerAgentId,
    title: body.title || null,
  };

  db.insert(copilotConversations).values(conversation).run();

  return Response.json(conversation, { status: 201 });
}
