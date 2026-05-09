import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { ingestOpportunityCandidate } from "@/lib/opportunities/ingest";
import {
  mapApolloLeadToCandidate,
  type ApolloLeadInput,
} from "@/lib/opportunities/source-adapters/apollo";

const apolloWarmIntroSchema = z.object({
  mutualName: z.string().optional(),
  mutualRef: z.string().optional(),
  pathSummary: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  freshness: z.number().min(0).max(100).optional(),
  connectorType: z.string().optional(),
}).optional();

const apolloLeadSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  email: z.string().email().optional(),
  linkedinUrl: z.string().optional(),
  companyName: z.string().optional(),
  companyDomain: z.string().optional(),
  companyLinkedinUrl: z.string().optional(),
  summary: z.string().optional(),
  signalType: z.string().optional(),
  freshness: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).default([]),
  warmIntro: apolloWarmIntroSchema,
});

const importApolloSchema = z.object({
  leads: z.array(apolloLeadSchema).min(1),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = importApolloSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const results = parsed.data.leads.map((lead) =>
    ingestOpportunityCandidate({
      tenantId,
      candidate: mapApolloLeadToCandidate(lead as ApolloLeadInput),
    }),
  );

  return Response.json(
    {
      imported: parsed.data.leads.length,
      created: results.filter((result) => result.created).length,
      updated: results.filter((result) => !result.created).length,
      results,
    },
    { status: 201 },
  );
}
