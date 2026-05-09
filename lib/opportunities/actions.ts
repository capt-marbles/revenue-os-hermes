import { db } from "@/db";
import {
  introPaths,
  opportunities,
  opportunityDrafts,
  opportunitySources,
  opportunitySyncEvents,
  outreachTemplates,
  sharedMemory,
  tasks,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { generateOpportunityDraft } from "@/lib/opportunities/drafting";
import { dispatchStageActions } from "@/lib/pipeline/stage-actions";

function now() {
  return new Date().toISOString();
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
    .where(
      and(
        eq(opportunities.tenantId, tenantId),
        eq(opportunities.id, opportunityId),
      ),
    )
    .get();

  if (!opportunity) {
    throw new Error("OPPORTUNITY_NOT_FOUND");
  }

  return opportunity;
}

export function selectOpportunityPath(params: {
  tenantId: string;
  opportunityId: string;
  path: "cold" | "warm";
}) {
  const opportunity = requireOpportunity(params.tenantId, params.opportunityId);
  const updatedAt = now();

  db.update(opportunities)
    .set({
      primaryPath: params.path,
      status: params.path === "warm" ? "intro_candidate" : "queued",
      lastActivityAt: updatedAt,
      updatedAt,
      metadata: JSON.stringify({
        ...parseJsonObject(opportunity.metadata),
        selectedPathAt: updatedAt,
        selectedPath: params.path,
      }),
    })
    .where(eq(opportunities.id, opportunity.id))
    .run();

  if (params.path === "warm") {
    db.update(introPaths)
      .set({
        status: "available",
        updatedAt,
      })
      .where(
        and(
          eq(introPaths.tenantId, params.tenantId),
          eq(introPaths.opportunityId, opportunity.id),
        ),
      )
      .run();
  }

  // Dispatch pipeline stage actions
  const newStatus = params.path === "warm" ? "intro_candidate" : "queued";
  dispatchStageActions({
    tenantId: params.tenantId,
    opportunityId: opportunity.id,
    opportunityTitle: opportunity.title,
    fromStatus: opportunity.status,
    toStatus: newStatus,
  });

  return {
    opportunityId: opportunity.id,
    primaryPath: params.path,
    status: params.path === "warm" ? "intro_candidate" : "queued",
  };
}

function pickTemplate(tenantId: string, draftType: "cold_email" | "intro_request" | "follow_up") {
  const templates = db
    .select()
    .from(outreachTemplates)
    .where(eq(outreachTemplates.tenantId, tenantId))
    .orderBy(desc(outreachTemplates.updatedAt))
    .all();

  if (templates.length === 0) return null;

  const wantedTag =
    draftType === "intro_request"
      ? "intro"
      : draftType === "follow_up"
        ? "follow-up"
        : "cold";

  const tagged = templates.find((template) => template.tags?.toLowerCase().includes(wantedTag));
  return tagged ?? templates[0];
}

function renderDraft(params: {
  draftType: "cold_email" | "intro_request" | "follow_up";
  title: string;
  accountName: string | null;
  contactName: string | null;
  rationaleSummary: string | null;
  templateBody?: string | null;
}) {
  const contact = params.contactName || "there";
  const account = params.accountName || "your team";
  const rationale = params.rationaleSummary || "a strong fit based on recent signals";

  if (params.templateBody) {
    return params.templateBody
      .replaceAll("{{contact_name}}", contact)
      .replaceAll("{{company}}", account)
      .replaceAll("{{reason}}", rationale);
  }

  if (params.draftType === "intro_request") {
    return [
      `Hi {{mutual_name}},`,
      "",
      `Could you introduce me to ${contact} at ${account}?`,
      `They came up as a strong fit because ${rationale}.`,
      "",
      `I can send a short blurb if helpful.`,
      "",
      `Thanks,`,
    ].join("\n");
  }

  if (params.draftType === "follow_up") {
    return [
      `Hi ${contact},`,
      "",
      `Following up on ${params.title}.`,
      `I thought it was still worth reaching out because ${rationale}.`,
      "",
      `If it is useful, I can send over a short migration or infrastructure recommendation.`,
      "",
      `Best,`,
    ].join("\n");
  }

  return [
    `Hi ${contact},`,
    "",
    `Reaching out because ${rationale}.`,
    `I think ${account} may be a fit for Gameye, especially if you are evaluating multiplayer infrastructure changes right now.`,
    "",
    `If useful, I can send a short recommendation tailored to your stack.`,
    "",
    `Best,`,
  ].join("\n");
}

export async function createOpportunityDraft(params: {
  tenantId: string;
  opportunityId: string;
  draftType?: "cold_email" | "intro_request" | "follow_up";
  approvalMode?: "auto" | "pending";
}) {
  const opportunity = requireOpportunity(params.tenantId, params.opportunityId);
  const draftType =
    params.draftType ??
    (opportunity.primaryPath === "warm" ? "intro_request" : "cold_email");
  const template = pickTemplate(params.tenantId, draftType);
  const createdAt = now();
  const draftId = ulid();
  const subject =
    draftType === "intro_request"
      ? `Intro to ${opportunity.primaryContactName || opportunity.accountName || "prospect"}`
      : `${opportunity.accountName || opportunity.title} · quick note`;
  const fallbackContent = renderDraft({
    draftType,
    title: opportunity.title,
    accountName: opportunity.accountName,
    contactName: opportunity.primaryContactName,
    rationaleSummary: opportunity.rationaleSummary,
    templateBody: template?.body,
  });
  const memory = db
    .select({
      category: sharedMemory.category,
      key: sharedMemory.key,
      value: sharedMemory.value,
    })
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, params.tenantId))
    .all();
  const sources = db
    .select({
      sourceType: opportunitySources.sourceType,
      rawSummary: opportunitySources.rawSummary,
    })
    .from(opportunitySources)
    .where(
      and(
        eq(opportunitySources.tenantId, params.tenantId),
        eq(opportunitySources.opportunityId, opportunity.id),
      ),
    )
    .all();
  const bestIntro = db
    .select()
    .from(introPaths)
    .where(
      and(
        eq(introPaths.tenantId, params.tenantId),
        eq(introPaths.opportunityId, opportunity.id),
      ),
    )
    .orderBy(desc(introPaths.confidence), desc(introPaths.freshness), desc(introPaths.updatedAt))
    .get();
  const generatedDraft = await generateOpportunityDraft({
    draftType,
    title: opportunity.title,
    accountName: opportunity.accountName,
    contactName: opportunity.primaryContactName,
    rationaleSummary: opportunity.rationaleSummary,
    templateBody: template?.body,
    fallbackSubject: subject,
    fallbackContent,
    memory,
    sources,
    introPath: bestIntro
      ? {
          mutualName: bestIntro.mutualName,
          pathSummary: bestIntro.pathSummary,
          confidence: bestIntro.confidence,
          freshness: bestIntro.freshness,
        }
      : null,
  });

  db.insert(opportunityDrafts)
    .values({
      id: draftId,
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      draftType,
      subject: generatedDraft.subject,
      content: generatedDraft.content,
      modelRef:
        generatedDraft.modelRef === "deterministic:v1" && template
          ? `template:${template.id}`
          : generatedDraft.modelRef,
      status: "generated",
      createdAt,
      updatedAt: createdAt,
    })
    .run();

  const approvalMode = params.approvalMode ?? "pending";
  if (approvalMode === "pending") {
    const existingReviewTask = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, params.tenantId),
          eq(tasks.source, "manual"),
          eq(tasks.title, `Review draft: ${opportunity.title}`),
        ),
      )
      .get();

    if (!existingReviewTask) {
      db.insert(tasks)
        .values({
          id: ulid(),
          tenantId: params.tenantId,
          title: `Review draft: ${opportunity.title}`,
          description: `Approve ${draftType} for ${opportunity.primaryContactName || opportunity.accountName || opportunity.title}`,
          status: "backlog",
          source: "manual",
          approvalMode: "before_send",
          approvalStatus: "pending",
          assigneeType: "human",
          assigneeId: null,
          priority: "high",
          position: 0,
          tags: JSON.stringify(["opportunity", "draft-review"]),
        })
        .run();
    }
  }

  db.update(opportunities)
    .set({
      status: "drafted",
      lastActivityAt: createdAt,
      updatedAt: createdAt,
    })
    .where(eq(opportunities.id, opportunity.id))
    .run();

  // Dispatch pipeline stage actions
  dispatchStageActions({
    tenantId: params.tenantId,
    opportunityId: opportunity.id,
    opportunityTitle: opportunity.title,
    fromStatus: opportunity.status,
    toStatus: "drafted",
  });

  return {
    draftId,
    opportunityId: opportunity.id,
    draftType,
    subject: generatedDraft.subject,
    content: generatedDraft.content,
    status: "generated",
    approvalMode,
    modelRef:
      generatedDraft.modelRef === "deterministic:v1" && template
        ? `template:${template.id}`
        : generatedDraft.modelRef,
  };
}

export function createOpportunitySyncEvent(params: {
  tenantId: string;
  opportunityId: string;
  targetSystem: "twenty" | "gmail" | "tasks";
  actionType: "create_contact" | "update_contact" | "create_note" | "create_draft" | "update_stage";
  externalRef?: string | null;
  payloadSummary?: string | null;
  status?: "pending" | "success" | "conflict" | "failed";
  errorClass?: string | null;
  errorMessage?: string | null;
}) {
  const opportunity = requireOpportunity(params.tenantId, params.opportunityId);
  const createdAt = now();
  const status = params.status ?? "pending";
  const syncId = ulid();

  db.insert(opportunitySyncEvents)
    .values({
      id: syncId,
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      targetSystem: params.targetSystem,
      actionType: params.actionType,
      status,
      externalRef: params.externalRef ?? null,
      payloadSummary: params.payloadSummary ?? null,
      errorClass: params.errorClass ?? null,
      errorMessage: params.errorMessage ?? null,
      createdAt,
    })
    .run();

  db.update(opportunities)
    .set({
      status: status === "success" ? "synced" : opportunity.status,
      attioRecordRef:
        params.targetSystem === "twenty" && params.externalRef
          ? params.externalRef
          : opportunity.attioRecordRef,
      lastActivityAt: createdAt,
      updatedAt: createdAt,
    })
    .where(eq(opportunities.id, opportunity.id))
    .run();

  // Dispatch pipeline stage actions on successful sync
  if (status === "success" && opportunity.status !== "synced") {
    dispatchStageActions({
      tenantId: params.tenantId,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      fromStatus: opportunity.status,
      toStatus: "synced",
    });
  }

  return {
    syncId,
    opportunityId: opportunity.id,
    targetSystem: params.targetSystem,
    actionType: params.actionType,
    status,
  };
}
