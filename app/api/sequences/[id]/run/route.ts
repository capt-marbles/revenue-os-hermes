import { NextRequest } from "next/server";
import { db } from "@/db";
import { sequences } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { executeSequence } from "@/lib/agents/sequence-executor";
import { z } from "zod";


const runSchema = z.object({
  input: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const sequence = db
    .select()
    .from(sequences)
    .where(and(eq(sequences.id, id), eq(sequences.tenantId, tenantId)))
    .get();

  if (!sequence) {
    return Response.json({ error: "Sequence not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Fire and forget — sequence runs in background
  const runPromise = executeSequence({
    sequenceId: id,
    input: parsed.data.input,
  });

  runPromise.catch((err) => {
    console.error(`Sequence ${id} execution error:`, err);
  });

  // Return immediately — client will poll for status
  return Response.json({ status: "started" }, { status: 202 });
}
