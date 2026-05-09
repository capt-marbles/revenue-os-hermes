import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunitySources } from "@/db/schema";
import {
  TwentyApiError,
  TwentyConfigError,
  upsertTwentyCompany,
  upsertTwentyOpportunity,
  upsertTwentyPerson,
  updateTwentyOpportunity,
  findTwentyOpportunityByName,
  type TwentyPersonValues,
} from "@/lib/crm/twenty";
import { createOpportunitySyncEvent } from "@/lib/opportunities/actions";

function splitName(fullName: string | null) {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function requireOpportunity(tenantId: string, opportunityId: string) {
  const opportunity = db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, opportunityId)))
    .get();
  if (!opportunity) throw new Error("OPPORTUNITY_NOT_FOUND");
  return opportunity;
}

function getLatestSourceEvidence(tenantId: string, opportunityId: string) {
  const latestSource = db
    .select()
    .from(opportunitySources)
    .where(
      and(
        eq(opportunitySources.tenantId, tenantId),
        eq(opportunitySources.opportunityId, opportunityId),
      ),
    )
    .orderBy(desc(opportunitySources.ingestedAt), desc(opportunitySources.createdAt))
    .get();
  return parseJsonObject(latestSource?.sourceEvidence);
}

function buildPersonValues(params: {
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactLinkedin: string | null;
  sourceEvidence: Record<string, unknown>;
}): TwentyPersonValues {
  const name = splitName(params.primaryContactName);
  const jobTitle =
    typeof params.sourceEvidence.title === "string" && params.sourceEvidence.title.trim()
      ? params.sourceEvidence.title.trim()
      : undefined;

  const values: TwentyPersonValues = {};
  if (name) {
    values.firstName = name.firstName;
    values.lastName = name.lastName;
  }
  if (params.primaryContactEmail) values.email = params.primaryContactEmail;
  if (params.primaryContactLinkedin) values.linkedinUrl = params.primaryContactLinkedin;
  if (jobTitle) values.jobTitle = jobTitle;
  return values;
}

export async function syncOpportunityToTwenty(params: {
  tenantId: string;
  opportunityId: string;
  actionType?: "create_contact" | "update_contact";
  payloadSummary?: string | null;
}) {
  const opportunity = requireOpportunity(params.tenantId, params.opportunityId);
  const sourceEvidence = getLatestSourceEvidence(params.tenantId, opportunity.id);
  const values = buildPersonValues({
    primaryContactName: opportunity.primaryContactName,
    primaryContactEmail: opportunity.primaryContactEmail,
    primaryContactLinkedin: opportunity.primaryContactLinkedin,
    sourceEvidence,
  });

  if (!values.email && !values.firstName && !values.linkedinUrl) {
    const errorMessage = "Opportunity is missing enough contact data to sync to Twenty";
    const event = createOpportunitySyncEvent({
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      targetSystem: "twenty",
      actionType: params.actionType ?? "create_contact",
      payloadSummary: params.payloadSummary ?? "Twenty sync requested",
      status: "failed",
      errorClass: "TwentyValidationError",
      errorMessage,
    });
    throw Object.assign(new Error(errorMessage), { code: "OPPORTUNITY_SYNC_UNMAPPABLE", event });
  }

  try {
    const person = await upsertTwentyPerson(values);
    const externalRef = person.id ?? opportunity.attioRecordRef ?? null;

    const event = createOpportunitySyncEvent({
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      targetSystem: "twenty",
      actionType:
        opportunity.attioRecordRef || params.actionType === "update_contact"
          ? "update_contact"
          : "create_contact",
      externalRef,
      payloadSummary:
        params.payloadSummary ??
        `Synced ${opportunity.primaryContactName || opportunity.title} to Twenty`,
      status: "success",
    });

    return { ...event, externalRef, twenty: person };
  } catch (error) {
    const isTwentyApiError = error instanceof TwentyApiError;
    const status = isTwentyApiError && error.status === 409 ? "conflict" : "failed";
    const errorClass =
      error instanceof TwentyConfigError
        ? "TwentyConfigError"
        : isTwentyApiError
          ? "TwentyApiError"
          : error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : "TwentySyncError";
    const errorMessage =
      error instanceof TwentyApiError
        ? error.details
        : error instanceof Error
          ? error.message
          : "Unknown Twenty sync error";

    const event = createOpportunitySyncEvent({
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      targetSystem: "twenty",
      actionType: params.actionType ?? "create_contact",
      payloadSummary: params.payloadSummary ?? "Twenty sync requested",
      status,
      errorClass,
      errorMessage,
    });

    throw Object.assign(error instanceof Error ? error : new Error(errorMessage), { event });
  }
}

// ─── Stage sync ───────────────────────────────────────────────────────────────

/**
 * Sync a local opportunity stage change back to Twenty CRM.
 *
 * Looks up the Twenty opportunity by name + company, creates it if missing,
 * then patches the stage. Also ensures the company and contact exist first.
 * Records a sync event regardless of outcome.
 */
export async function syncOpportunityStageToTwenty(params: {
  tenantId: string;
  opportunityId: string;
  stage: string;
  payloadSummary?: string;
}): Promise<{ syncId: string; twentyOpportunityId: string }> {
  const opportunity = db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, params.tenantId),
        eq(opportunities.id, params.opportunityId),
      ),
    )
    .get();

  if (!opportunity) throw new Error("OPPORTUNITY_NOT_FOUND");

  try {
    // 1. Ensure company exists in Twenty
    let companyId: string | undefined;
    if (opportunity.accountName) {
      const company = await upsertTwentyCompany({ name: opportunity.accountName });
      companyId = company.id;
    }

    // 2. Ensure contact exists in Twenty
    let pointOfContactId: string | undefined;
    if (opportunity.primaryContactEmail || opportunity.primaryContactName) {
      const sourceEvidence = getLatestSourceEvidence(params.tenantId, opportunity.id);
      const values = buildPersonValues({
        primaryContactName: opportunity.primaryContactName,
        primaryContactEmail: opportunity.primaryContactEmail,
        primaryContactLinkedin: opportunity.primaryContactLinkedin,
        sourceEvidence,
      });
      if (companyId) values.companyId = companyId;
      const person = await upsertTwentyPerson(values);
      pointOfContactId = person.id;
    }

    // 3. Upsert opportunity and set stage
    const twentyOpp = await upsertTwentyOpportunity({
      name: opportunity.title,
      stage: params.stage,
      companyId,
      pointOfContactId,
    });

    // If it already existed, make sure the stage is updated
    if (twentyOpp.id) {
      await updateTwentyOpportunity(twentyOpp.id, { stage: params.stage });
    }

    const event = createOpportunitySyncEvent({
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      targetSystem: "twenty",
      actionType: "update_contact",
      externalRef: twentyOpp.id,
      payloadSummary:
        params.payloadSummary ??
        `Stage synced to Twenty: ${params.stage} for ${opportunity.title}`,
      status: "success",
    });

    return { syncId: event.syncId, twentyOpportunityId: twentyOpp.id };
  } catch (error) {
    const isTwentyApiError = error instanceof TwentyApiError;
    const errorClass =
      error instanceof TwentyConfigError
        ? "TwentyConfigError"
        : isTwentyApiError
          ? "TwentyApiError"
          : "TwentyStageSyncError";
    const errorMessage =
      isTwentyApiError
        ? error.details
        : error instanceof Error
          ? error.message
          : "Unknown error syncing stage to Twenty";

    createOpportunitySyncEvent({
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      targetSystem: "twenty",
      actionType: "update_contact",
      payloadSummary: params.payloadSummary ?? `Stage sync attempted: ${params.stage}`,
      status: "failed",
      errorClass,
      errorMessage,
    });

    throw error;
  }
}
