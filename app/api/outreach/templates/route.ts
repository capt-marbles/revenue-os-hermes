import { NextRequest } from "next/server";
import { db } from "@/db";
import { outreachTemplates } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

export async function GET() {
  const tenantId = getTenantId();

  const result = db
    .select()
    .from(outreachTemplates)
    .where(eq(outreachTemplates.tenantId, tenantId))
    .orderBy(desc(outreachTemplates.updatedAt))
    .all();

  return Response.json(result);
}

const createTemplateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  channel: z.enum(["email", "linkedin"]).default("email"),
  tags: z.string().default("[]"),
  parentId: z.string().optional(),
  version: z.number().int().default(1),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const template = {
    id: ulid(),
    tenantId,
    ...data,
  };

  db.insert(outreachTemplates).values(template).run();

  return Response.json(template, { status: 201 });
}
