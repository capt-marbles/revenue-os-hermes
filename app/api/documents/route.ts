import { NextRequest } from "next/server";
import { db } from "@/db";
import { documents, agents, desks } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { randomUUID } from "crypto";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = request.nextUrl;
  const agentId = searchParams.get("agent_id");
  const taskId = searchParams.get("taskId");
  const search = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  let results = db
    .select({
      doc: documents,
      agentName: agents.name,
    })
    .from(documents)
    .leftJoin(agents, eq(documents.agentId, agents.id))
    .where(eq(documents.tenantId, tenantId))
    .orderBy(desc(documents.createdAt))
    .limit(limit)
    .all();

  if (agentId) {
    results = results.filter((r) => r.doc.agentId === agentId);
  }

  if (taskId) {
    results = results.filter((r) => r.doc.taskId === taskId);
  }

  if (search) {
    const q = search.toLowerCase();
    results = results.filter(
      (r) =>
        r.doc.title.toLowerCase().includes(q) ||
        r.doc.content.toLowerCase().includes(q) ||
        (r.agentName?.toLowerCase().includes(q))
    );
  }

  return Response.json(
    results.map((r) => ({
      ...r.doc,
      agentName: r.agentName,
    }))
  );
}

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();

  let body: {
    title: string;
    content: string;
    summary?: string;
    tags?: string[];
    deskSlug?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.title?.trim() || !body.content?.trim()) {
    return Response.json({ error: "title and content are required" }, { status: 400 });
  }

  // Resolve deskSlug → deskId if provided
  let deskId: string | null = null;
  if (body.deskSlug) {
    const desk = db
      .select({ id: desks.id })
      .from(desks)
      .where(eq(desks.slug, body.deskSlug))
      .get();
    deskId = desk?.id ?? null;
  }

  const now = new Date().toISOString();
  const doc = db
    .insert(documents)
    .values({
      id: randomUUID(),
      tenantId,
      deskId,
      title: body.title.trim(),
      content: body.content.trim(),
      summary: body.summary?.trim() ?? null,
      tags: JSON.stringify(body.tags ?? []),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return Response.json(doc, { status: 201 });
}
