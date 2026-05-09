import { NextRequest } from "next/server";
import { db } from "@/db";
import { directorWiki, desks } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = request.nextUrl;
  const deskSlug = searchParams.get("deskId");
  const category = searchParams.get("category");
  const search = searchParams.get("q");

  // Resolve desk
  let deskId: string | null = null;
  if (deskSlug) {
    const desk = db.select().from(desks).where(
      and(eq(desks.tenantId, tenantId), eq(desks.slug, deskSlug))
    ).get() || db.select().from(desks).where(
      and(eq(desks.id, deskSlug), eq(desks.tenantId, tenantId))
    ).get();
    deskId = desk?.id ?? null;
  }

  let results = db
    .select()
    .from(directorWiki)
    .where(eq(directorWiki.tenantId, tenantId))
    .orderBy(desc(directorWiki.updatedAt))
    .all();

  if (deskId) {
    results = results.filter((e) => e.deskId === deskId);
  }
  if (category) {
    results = results.filter((e) => e.category === category);
  }
  if (search) {
    const q = search.toLowerCase();
    results = results.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.slug.toLowerCase().includes(q)
    );
  }

  return Response.json(results);
}

const createSchema = z.object({
  deskId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1).optional(),
  category: z.enum(["competitor", "icp_segment", "tactic", "insight", "process", "reference"]),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Resolve desk slug to ID
  const desk = db.select().from(desks).where(
    and(eq(desks.tenantId, tenantId), eq(desks.slug, data.deskId))
  ).get() || db.select().from(desks).where(
    and(eq(desks.id, data.deskId), eq(desks.tenantId, tenantId))
  ).get();

  if (!desk) {
    return Response.json({ error: "Desk not found" }, { status: 404 });
  }

  const slug = data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const entry = {
    id: ulid(),
    tenantId,
    deskId: desk.id,
    slug,
    title: data.title,
    category: data.category,
    content: data.content,
    tags: JSON.stringify(data.tags),
    confidence: data.confidence,
  };

  db.insert(directorWiki).values(entry).run();

  return Response.json(entry, { status: 201 });
}
