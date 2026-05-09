import { NextRequest } from "next/server";
import { db } from "@/db";
import { outreachSends, outreachResponses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const tenantId = getTenantId();
  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("templateId");
  const contactRef = searchParams.get("contactRef");

  let conditions = [eq(outreachSends.tenantId, tenantId)];
  if (templateId) {
    conditions.push(eq(outreachSends.templateId, templateId));
  }
  if (contactRef) {
    conditions.push(eq(outreachSends.contactRef, contactRef));
  }

  const sends = db
    .select()
    .from(outreachSends)
    .where(and(...conditions))
    .all();

  // Fetch responses for these sends
  const sendIds = sends.map((s) => s.id);
  const responses = sendIds.length > 0
    ? db
        .select()
        .from(outreachResponses)
        .where(eq(outreachResponses.tenantId, tenantId))
        .all()
        .filter((r) => sendIds.includes(r.sendId))
    : [];

  const responseMap = new Map<string, typeof responses>();
  for (const r of responses) {
    const existing = responseMap.get(r.sendId) ?? [];
    existing.push(r);
    responseMap.set(r.sendId, existing);
  }

  const enriched = sends.map((s) => ({
    ...s,
    responses: responseMap.get(s.id) ?? [],
  }));

  return Response.json(enriched);
}

const createSendSchema = z.object({
  templateId: z.string().min(1),
  contactRef: z.string().min(1),
  contactName: z.string().optional(),
  companyName: z.string().optional(),
  channel: z.enum(["email", "linkedin"]).default("email"),
  agentRunId: z.string().optional(),
  icpSegment: z.string().optional(),
  metadata: z.string().default("{}"),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createSendSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const send = {
    id: ulid(),
    tenantId,
    ...data,
  };

  db.insert(outreachSends).values(send).run();

  return Response.json(send, { status: 201 });
}
