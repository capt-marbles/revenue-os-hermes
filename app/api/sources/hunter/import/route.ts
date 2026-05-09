import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { ingestOpportunityCandidate } from "@/lib/opportunities/ingest";
import {
  mapHunterLeadToCandidate,
  type HunterLeadInput,
} from "@/lib/opportunities/source-adapters/hunter";

const hunterPhoneNumberSchema = z.object({
  number: z.string().optional(),
  type: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
}).optional();

const hunterLeadSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  position: z.string().optional(),
  company: z.string().optional(),
  domain: z.string().optional(),
  linkedin: z.string().optional(),
  twitter: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  department: z.string().optional(),
  seniority: z.string().optional(),
  phoneNumbers: z.array(hunterPhoneNumberSchema).optional(),
  verificationStatus: z.enum(["risky", "valid", "unverified"]).optional(),
});

const importHunterSchema = z.object({
  leads: z.array(hunterLeadSchema).min(1),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = importHunterSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const results = parsed.data.leads.map((lead) =>
    ingestOpportunityCandidate({
      tenantId,
      candidate: mapHunterLeadToCandidate(lead as HunterLeadInput),
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
