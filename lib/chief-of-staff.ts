import { db } from "@/db";
import { agents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export const CHIEF_OF_STAFF_SLUG = "chief-of-staff";

export function getChiefOfStaff() {
  const tenantId = getTenantId();
  return db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.tenantId, tenantId),
        eq(agents.agentType, "chief_of_staff"),
        eq(agents.slug, CHIEF_OF_STAFF_SLUG),
      ),
    )
    .get();
}
