import { NextRequest } from "next/server";
import { db } from "@/db";
import { sequenceRuns, documents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const run = db
    .select()
    .from(sequenceRuns)
    .where(and(eq(sequenceRuns.id, id), eq(sequenceRuns.tenantId, tenantId)))
    .get();

  if (!run) {
    return Response.json({ error: "Sequence run not found" }, { status: 404 });
  }

  // Get documents created by this run
  const docs = db
    .select()
    .from(documents)
    .where(eq(documents.sequenceRunId, id))
    .all();

  return Response.json({ ...run, documents: docs });
}
