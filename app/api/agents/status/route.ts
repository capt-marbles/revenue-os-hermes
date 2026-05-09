import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export async function GET() {
  const tenantId = getTenantId();
  const result = db
    .select({ id: agents.id, status: agents.status })
    .from(agents)
    .where(eq(agents.tenantId, tenantId))
    .all();

  return Response.json(result);
}
