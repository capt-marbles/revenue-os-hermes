import { NextRequest } from "next/server";
import { db } from "@/db";
import { documentReplies, documents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const doc = db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
    .get();

  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  const replies = db
    .select()
    .from(documentReplies)
    .where(eq(documentReplies.documentId, id))
    .all();

  return Response.json(replies);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = getTenantId();
  const { content } = await request.json();

  if (!content?.trim()) {
    return Response.json({ error: "content required" }, { status: 400 });
  }

  const doc = db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
    .get();

  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  const reply = {
    id: ulid(),
    tenantId,
    documentId: id,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };

  db.insert(documentReplies).values(reply).run();

  return Response.json(reply, { status: 201 });
}
