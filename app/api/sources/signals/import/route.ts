import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { ingestOpportunityCandidate } from "@/lib/opportunities/ingest";
import {
  mapSignalToCandidate,
  type SignalImportInput,
} from "@/lib/opportunities/source-adapters/signals";

const warmIntroSchema = z.object({
  mutualName: z.string().optional(),
  mutualRef: z.string().optional(),
  pathSummary: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  freshness: z.number().min(0).max(100).optional(),
  connectorType: z.string().optional(),
}).optional();

const signalSchema = z.object({
  id: z.string().min(1),
  sourceType: z.enum(["website", "youtube", "news", "community", "manual"]).optional(),
  signalType: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().min(1),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  freshness: z.number().min(0).max(1).optional(),
  accountName: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactLinkedin: z.string().optional(),
  competitor: z.string().optional(),
  tags: z.array(z.string()).default([]),
  warmIntro: warmIntroSchema,
});

const importSignalsSchema = z.object({
  signals: z.array(signalSchema).min(1),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = importSignalsSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const results = parsed.data.signals.map((signal) =>
    ingestOpportunityCandidate({
      tenantId,
      candidate: mapSignalToCandidate(signal as SignalImportInput),
    }),
  );

  return Response.json(
    {
      imported: parsed.data.signals.length,
      created: results.filter((result) => result.created).length,
      updated: results.filter((result) => !result.created).length,
      results,
    },
    { status: 201 },
  );
}
