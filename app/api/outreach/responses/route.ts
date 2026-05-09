import { NextRequest } from "next/server";
import { db } from "@/db";
import { outreachResponses } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { z } from "zod";

const createResponseSchema = z.object({
  sendId: z.string().min(1),
  responseType: z.enum(["reply", "bounce", "open", "click", "meeting_booked", "unsubscribe"]),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = createResponseSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const response = {
    id: ulid(),
    tenantId,
    ...data,
  };

  db.insert(outreachResponses).values(response).run();

  return Response.json(response, { status: 201 });
}
