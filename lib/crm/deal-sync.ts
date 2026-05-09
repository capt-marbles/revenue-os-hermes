import { and, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/db";
import { dealActivities, deals } from "@/db/schema";
import {
  type LocalDealStage,
  normalizeLocalDealStage,
} from "@/lib/crm/deal-stages";
import {
  TwentyConfigError,
  findTwentyOpportunityByName,
  queryTwentyCompanies,
  queryTwentyOpportunities,
  queryTwentyPeople,
  upsertTwentyCompany,
  upsertTwentyOpportunity,
  upsertTwentyPerson,
  updateTwentyOpportunity,
} from "@/lib/crm/twenty";

const TWENTY_TO_LOCAL_STAGE: Record<string, LocalDealStage> = {
  TARGET_ACCOUNT: "target_account",
  NURTURE: "target_account",
  ON_HOLD: "target_account",
  SIGNAL_RECEIVED: "target_account",
  REACHOUT: "reachout",
  CONNECTED: "connected",
  SCREENING: "reachout",
  TECHNICAL_EVALUATION: "technical_evaluation",
  PROPOSAL: "quote_issued",
  NEGOTIATION: "quote_issued",
  COMMITTED: "committed",
  WON: "contract_signed",
  LOST: "lost",
};

const LOCAL_TO_TWENTY_STAGE: Record<LocalDealStage, string> = {
  target_account: "TARGET_ACCOUNT",
  reachout: "REACHOUT",
  connected: "CONNECTED",
  technical_evaluation: "TECHNICAL_EVALUATION",
  quote_issued: "PROPOSAL",
  committed: "COMMITTED",
  contract_signed: "WON",
  live: "WON",
  lost: "LOST",
};

interface TwentyCompanyRecord {
  id: string;
  name?: string | null;
}

interface TwentyPersonRecord {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  emails?: { primaryEmail?: string | null } | null;
}

interface TwentyOpportunityRecord {
  id: string;
  name?: string | null;
  stage?: string | null;
  companyId?: string | null;
  pointOfContactId?: string | null;
  closeDate?: string | null;
  amount?: { amountMicros?: number | null } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCloseDate(value?: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function personName(person?: TwentyPersonRecord | null): string | null {
  if (!person?.name) return null;
  const parts = [person.name.firstName, person.name.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function logDealActivity(dealId: string, content: string, type: "note" | "stage_change" = "note") {
  db.insert(dealActivities)
    .values({
      id: ulid(),
      dealId,
      content,
      type,
      createdAt: nowIso(),
    })
    .run();
}

function mapTwentyStageToLocal(stage?: string | null): LocalDealStage | null {
  if (!stage) return null;
  return TWENTY_TO_LOCAL_STAGE[stage] ?? null;
}

export function mapLocalStageToTwenty(stage: string): string {
  const normalized = normalizeLocalDealStage(stage);
  return normalized ? LOCAL_TO_TWENTY_STAGE[normalized] : "REACHOUT";
}

export async function syncLocalDealToTwenty(params: {
  tenantId: string;
  dealId: string;
}): Promise<{ dealId: string; twentyId: string; created: boolean }> {
  const deal = db
    .select()
    .from(deals)
    .where(and(eq(deals.id, params.dealId), eq(deals.tenantId, params.tenantId)))
    .get();

  if (!deal) {
    throw new Error("DEAL_NOT_FOUND");
  }

  let companyId: string | undefined;
  if (deal.studioName?.trim()) {
    companyId = (await upsertTwentyCompany({ name: deal.studioName.trim() })).id;
  }

  let pointOfContactId: string | undefined;
  if (deal.contactEmail || deal.contactName) {
    const [firstName, ...rest] = (deal.contactName ?? "").trim().split(/\s+/).filter(Boolean);
    pointOfContactId = (
      await upsertTwentyPerson({
        firstName: firstName || undefined,
        lastName: rest.length > 0 ? rest.join(" ") : undefined,
        email: deal.contactEmail ?? undefined,
        companyId,
      })
    ).id;
  }

  const payload = {
    name: deal.name,
    stage: mapLocalStageToTwenty(deal.stage),
    companyId,
    pointOfContactId,
    closeDate: deal.closeDate ?? undefined,
  };

  let twentyId = deal.twentyId ?? undefined;
  let created = false;

  if (!twentyId) {
    const existing = await findTwentyOpportunityByName(deal.name, companyId);
    if (existing?.id) {
      twentyId = existing.id;
    }
  }

  if (twentyId) {
    await updateTwentyOpportunity(twentyId, payload);
  } else {
    const createdOpportunity = await upsertTwentyOpportunity(payload);
    twentyId = createdOpportunity.id;
    created = true;
  }

  if (!deal.twentyId || deal.twentyId !== twentyId) {
    db.update(deals)
      .set({ twentyId, updatedAt: nowIso() })
      .where(eq(deals.id, deal.id))
      .run();
  }

  logDealActivity(
    deal.id,
    created
      ? `Created in Twenty (${payload.stage})`
      : `Synced to Twenty (${payload.stage})`,
  );

  return { dealId: deal.id, twentyId, created };
}

export async function syncLocalDealsToTwenty(params: {
  tenantId: string;
  dealIds?: string[];
}): Promise<{ synced: number; created: number; failed: number; results: Array<{ dealId: string; twentyId?: string; error?: string }> }> {
  const rows = params.dealIds?.length
    ? db
        .select()
        .from(deals)
        .where(and(eq(deals.tenantId, params.tenantId), inArray(deals.id, params.dealIds)))
        .all()
    : db
        .select()
        .from(deals)
        .where(eq(deals.tenantId, params.tenantId))
        .all();

  const results: Array<{ dealId: string; twentyId?: string; error?: string }> = [];
  let synced = 0;
  let created = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await syncLocalDealToTwenty({ tenantId: params.tenantId, dealId: row.id });
      synced += 1;
      if (result.created) created += 1;
      results.push({ dealId: row.id, twentyId: result.twentyId });
    } catch (error) {
      failed += 1;
      results.push({
        dealId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { synced, created, failed, results };
}

export async function syncTwentyDealsToLocal(params: {
  tenantId: string;
}): Promise<{ imported: number; updated: number; skipped: number }> {
  const [opportunities, companies, people] = await Promise.all([
    queryTwentyOpportunities() as Promise<TwentyOpportunityRecord[]>,
    queryTwentyCompanies() as Promise<TwentyCompanyRecord[]>,
    queryTwentyPeople() as Promise<TwentyPersonRecord[]>,
  ]);

  const companyMap = new Map(companies.map((company) => [company.id, company.name ?? null]));
  const personMap = new Map(people.map((person) => [person.id, person]));

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const opportunity of opportunities) {
    const localStage = mapTwentyStageToLocal(opportunity.stage);
    if (!localStage) {
      skipped += 1;
      continue;
    }

    const studioName = opportunity.companyId ? companyMap.get(opportunity.companyId) ?? null : null;
    const person = opportunity.pointOfContactId ? personMap.get(opportunity.pointOfContactId) ?? null : null;
    const existing = db
      .select()
      .from(deals)
      .where(and(eq(deals.tenantId, params.tenantId), eq(deals.twentyId, opportunity.id)))
      .get()
      ?? (
        opportunity.name
          ? db
              .select()
              .from(deals)
              .where(
                and(
                  eq(deals.tenantId, params.tenantId),
                  eq(deals.name, opportunity.name),
                ),
              )
              .get()
          : null
      );

    const values = {
      name: opportunity.name || "Untitled",
      stage: localStage,
      contactName: personName(person),
      contactEmail: person?.emails?.primaryEmail ?? null,
      closeDate: normalizeCloseDate(opportunity.closeDate),
      mrr: opportunity.amount?.amountMicros != null ? opportunity.amount.amountMicros / 1_000_000 : null,
      studioName,
      twentyId: opportunity.id,
      updatedAt: opportunity.updatedAt ?? nowIso(),
    };

    if (existing) {
      db.update(deals)
        .set(values)
        .where(eq(deals.id, existing.id))
        .run();
      updated += 1;
      continue;
    }

    db.insert(deals)
      .values({
        id: ulid(),
        tenantId: params.tenantId,
        salesMotion: "outbound",
        revenueDate: null,
        notes: null,
        position: 0,
        createdAt: opportunity.createdAt ?? nowIso(),
        ...values,
      })
      .run();
    imported += 1;
  }

  return { imported, updated, skipped };
}

export async function syncDealsWithTwenty(params: {
  tenantId: string;
  direction?: "pull" | "push" | "both";
  dealIds?: string[];
}) {
  const direction = params.direction ?? "both";

  if (direction === "pull") {
    return {
      direction,
      pull: await syncTwentyDealsToLocal({ tenantId: params.tenantId }),
    };
  }

  if (direction === "push") {
    return {
      direction,
      push: await syncLocalDealsToTwenty({ tenantId: params.tenantId, dealIds: params.dealIds }),
    };
  }

  return {
    direction,
    pull: await syncTwentyDealsToLocal({ tenantId: params.tenantId }),
    push: await syncLocalDealsToTwenty({ tenantId: params.tenantId, dealIds: params.dealIds }),
  };
}

export { TwentyConfigError };
