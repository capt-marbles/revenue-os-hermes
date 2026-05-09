import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { dispatchMatchingTriggers } from "@/lib/orchestration/trigger-router";
import { copilotChatSync, getOrCreateSystemConversation } from "@/lib/agents/copilot-chat-sync";
import { ingestOpportunityCandidate } from "@/lib/opportunities/ingest";

const webhookSchema = z.object({
  eventType: z.string().min(1),
  input: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const opportunityCandidateSchema = z.object({
  sourceType: z.string().min(1),
  externalRef: z.string().min(1),
  title: z.string().optional(),
  accountName: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactLinkedin: z.string().optional(),
  signalType: z.string().optional(),
  summary: z.string().min(1),
  freshness: z.number().min(0).max(1),
  sourceEvidence: z.record(z.string(), z.unknown()).default({}),
  suggestedPath: z.enum(["cold", "warm", "none"]).optional(),
  rawPayloadRef: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = webhookSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { eventType, input, metadata } = parsed.data;
  const candidateResults = [];
  const singleCandidate = opportunityCandidateSchema.safeParse(metadata.opportunityCandidate);
  if (singleCandidate.success) {
    candidateResults.push(
      ingestOpportunityCandidate({
        tenantId,
        candidate: singleCandidate.data,
      }),
    );
  }

  const candidateList = z.array(opportunityCandidateSchema).safeParse(metadata.opportunityCandidates);
  if (candidateList.success) {
    for (const candidate of candidateList.data) {
      candidateResults.push(
        ingestOpportunityCandidate({
          tenantId,
          candidate,
        }),
      );
    }
  }

  const result = dispatchMatchingTriggers(tenantId, "webhook", {
    input,
    source: "webhook",
    metadata: {
      eventType,
      ...metadata,
    },
  });

  const conversationId = getOrCreateSystemConversation(`webhook:${eventType}`);
  void copilotChatSync(
    conversationId,
    [
      `Webhook event received: ${eventType}`,
      "",
      input,
      "",
      candidateResults.length > 0
        ? `Opportunity ingestion: ${candidateResults.length} candidate${candidateResults.length === 1 ? "" : "s"} merged into the queue.`
        : "Opportunity ingestion: none attached to this webhook payload.",
      "",
      "If follow-up work is needed, propose explicit Recommended Action blocks. Use Approval Mode: before_send for any external outreach or customer-visible action.",
    ].join("\n"),
  );

  return Response.json({
    accepted: result.triggered.length > 0,
    conversationId,
    ingested: candidateResults,
    triggered: result.triggered,
    skipped: result.skipped,
  });
}
