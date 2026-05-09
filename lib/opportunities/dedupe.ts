import { db } from "@/db";
import { opportunities, opportunitySources } from "@/db/schema";
import type { OpportunityCandidate } from "@/lib/opportunities/candidate";
import { and, eq } from "drizzle-orm";

export interface OpportunityMatch {
  id: string;
  reason: "source_ref" | "email" | "linkedin" | "account_contact";
}

export function findExistingOpportunity(
  tenantId: string,
  candidate: OpportunityCandidate,
): OpportunityMatch | null {
  const sourceMatch = db
    .select({
      id: opportunitySources.opportunityId,
    })
    .from(opportunitySources)
    .where(
      and(
        eq(opportunitySources.tenantId, tenantId),
        eq(opportunitySources.sourceType, candidate.sourceType),
        eq(opportunitySources.sourceRef, candidate.externalRef),
      ),
    )
    .get();

  if (sourceMatch) {
    return { id: sourceMatch.id, reason: "source_ref" };
  }

  if (candidate.contactEmail) {
    const emailMatch = db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.tenantId, tenantId),
          eq(opportunities.primaryContactEmail, candidate.contactEmail),
        ),
      )
      .get();

    if (emailMatch) {
      return { id: emailMatch.id, reason: "email" };
    }
  }

  if (candidate.contactLinkedin) {
    const linkedinMatch = db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.tenantId, tenantId),
          eq(opportunities.primaryContactLinkedin, candidate.contactLinkedin),
        ),
      )
      .get();

    if (linkedinMatch) {
      return { id: linkedinMatch.id, reason: "linkedin" };
    }
  }

  if (candidate.accountName && candidate.contactName) {
    const accountContactMatch = db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.tenantId, tenantId),
          eq(opportunities.accountName, candidate.accountName),
          eq(opportunities.primaryContactName, candidate.contactName),
        ),
      )
      .get();

    if (accountContactMatch) {
      return { id: accountContactMatch.id, reason: "account_contact" };
    }
  }

  return null;
}
