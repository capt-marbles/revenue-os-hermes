import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { db } from "@/db";
import { connectors } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { ingestOpportunityCandidate } from "@/lib/opportunities/ingest";
import { mapHunterLeadToCandidate, type HunterLeadInput } from "@/lib/opportunities/source-adapters/hunter";

const HUNTER_API = "https://api.hunter.io/v2";

function getHunterKey(): string | null {
  if (process.env.HUNTER_API_KEY) return process.env.HUNTER_API_KEY;

  const tenantId = getTenantId();
  const conn = db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.name, "hunter-email")))
    .get();

  if (conn?.config) {
    try {
      const cfg = JSON.parse(conn.config);
      return cfg.apiKey || null;
    } catch {}
  }
  return null;
}

async function hunterFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const apiKey = getHunterKey();
  if (!apiKey) {
    return Response.json({ error: "Hunter API key not configured" }, { status: 400 });
  }

  const url = new URL(`${HUNTER_API}${path}`);
  url.searchParams.set("api_key", apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString());

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hunter API ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── POST /api/integrations/hunter/search ──────────────────────────────────
// Search Hunter for leads at a specific company domain.
const searchSchema = z.object({
  domain: z.string().min(1).describe("Company domain (e.g. gameye.com)"),
  department: z.string().optional(),
  seniority: z.string().optional(),
  jobTitle: z.string().optional(),
  type: z.enum(["personal", "generic"]).optional(),
  limit: z.number().min(1).max(100).default(10),
  autoIngest: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = searchSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { autoIngest, ...params } = parsed.data;

  try {
    const data = (await hunterFetch("/domain-search", {
      domain: params.domain,
      department: params.department || "",
      seniority: params.seniority || "",
      job_title: params.jobTitle || "",
      type: params.type || "",
      limit: String(params.limit),
    })) as Record<string, any>;

    const results = (data?.data?.emails || []) as Array<Record<string, unknown>>;
    const meta = data?.meta as Record<string, unknown> | undefined;

    let ingested = 0;
    let ingestErrors = 0;

    if (autoIngest && results.length > 0) {
      for (const email of results) {
        try {
          const cleaned = String(email.first_name || "") + "-" + String(email.last_name || "") + "-" + (email.value || "");
          ingestOpportunityCandidate({
            tenantId,
            candidate: mapHunterLeadToCandidate({
              id: cleaned,
              firstName: email.first_name as string | null,
              lastName: email.last_name as string | null,
              email: email.value as string | null,
              position: email.position as string | null,
              company: email.company as string | null,
              domain: params.domain,
              linkedin: email.linkedin as string | null,
              twitter: email.twitter as string | null,
              confidence: email.confidence as number | null,
              department: email.department as string | null,
              seniority: email.seniority as string | null,
              phoneNumbers: (email.phone_numbers ?? null) as HunterLeadInput["phoneNumbers"],
              verificationStatus: email.verification_status as string | null,
            }),
          });
          ingested++;
        } catch {
          ingestErrors++;
        }
      }
    }

    logAudit({
      action: "integration.hunter.search",
      entity: "integration",
      summary: `Hunter search: "${params.domain}" → ${results.length} results (${ingested} ingested)`,
      source: "operator",
      metadata: { domain: params.domain, returned: results.length, ingested },
    });

    return Response.json({
      results,
      meta,
      total: (meta?.results as number) || results.length,
      ingested,
      ingestErrors,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Hunter search failed" },
      { status: 502 },
    );
  }
}

// ─── POST /api/integrations/hunter/verify ──────────────────────────────────
// Verify a single email address.
const verifySchema = z.object({
  email: z.string().email(),
});

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = verifySchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const data = (await hunterFetch("/email-verifier", {
      email: parsed.data.email,
    })) as Record<string, unknown>;

    const result = data?.data as Record<string, unknown> | undefined;

    return Response.json({
      email: parsed.data.email,
      result: result || null,
      deliverable: result?.result as string | null, // "deliverable" | "undeliverable" | "risky" | "unknown"
      score: result?.score as number | null,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Hunter verify failed" },
      { status: 502 },
    );
  }
}

// ─── POST /api/integrations/hunter/find ────────────────────────────────────
// Find a specific person's email (first + last + domain).
const findSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  domain: z.string().min(1),
  autoIngest: z.boolean().default(true),
});

export async function PATCH(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = findSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { autoIngest, ...params } = parsed.data;

  try {
    const data = (await hunterFetch("/email-finder", {
      first_name: params.firstName,
      last_name: params.lastName,
      domain: params.domain,
    })) as Record<string, unknown>;

    const result = data?.data as Record<string, unknown> | undefined;

    if (!result?.email) {
      return Response.json({ error: "No email found" }, { status: 404 });
    }

    let ingested = false;
    if (autoIngest) {
      try {
        ingestOpportunityCandidate({
          tenantId,
          candidate: mapHunterLeadToCandidate({
            id: `${params.firstName}-${params.lastName}-${result.email}`,
            firstName: result.first_name as string | null,
            lastName: result.last_name as string | null,
            email: result.email as string | null,
            position: result.position as string | null,
            company: result.company as string | null,
            domain: params.domain,
            linkedin: result.linkedin as string | null,
            twitter: result.twitter as string | null,
            confidence: result.confidence as number | null,
            verificationStatus: result.verification_status as string | null,
          }),
        });
        ingested = true;
      } catch {}
    }

    logAudit({
      action: "integration.hunter.find",
      entity: "integration",
      summary: `Hunter find: ${params.firstName} ${params.lastName} @ ${params.domain} → ${result.email}`,
      source: "operator",
    });

    return Response.json({
      email: result.email,
      confidence: result.confidence,
      verificationStatus: result.verification_status,
      position: result.position,
      company: result.company,
      linkedin: result.linkedin,
      ingested,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Hunter find failed" },
      { status: 502 },
    );
  }
}

// ─── GET /api/integrations/hunter/status ───────────────────────────────────
export async function GET() {
  const apiKey = getHunterKey();
  return Response.json({
    configured: !!apiKey,
    source: apiKey ? (process.env.HUNTER_API_KEY ? "env" : "connector") : null,
  });
}
