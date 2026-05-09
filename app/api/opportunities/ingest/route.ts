import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { ingestOpportunityCandidate } from "@/lib/opportunities/ingest";

const sourceEvidenceSchema = z.record(z.string(), z.unknown()).default({});

const candidateSchema = z.object({
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
  sourceEvidence: sourceEvidenceSchema,
  suggestedPath: z.enum(["cold", "warm", "none"]).optional(),
  rawPayloadRef: z.string().optional(),
});

const ingestSchema = z.object({
  candidate: candidateSchema.optional(),
  candidates: z.array(candidateSchema).optional(),
}).refine((value) => value.candidate || value.candidates?.length, {
  message: "Provide candidate or candidates",
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = ingestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const candidates = parsed.data.candidate
    ? [parsed.data.candidate]
    : parsed.data.candidates ?? [];

  const results = candidates.map((candidate) =>
    ingestOpportunityCandidate({
      tenantId,
      candidate,
    }),
  );

  return Response.json(
    {
      ingested: results.length,
      created: results.filter((item) => item.created).length,
      updated: results.filter((item) => !item.created).length,
      results,
    },
    { status: 201 },
  );
}
