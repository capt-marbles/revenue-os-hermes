import { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { db } from "@/db";
import { connectors } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { ingestOpportunityCandidate } from "@/lib/opportunities/ingest";
import { mapApolloLeadToCandidate, type ApolloLeadInput } from "@/lib/opportunities/source-adapters/apollo";

const APOLLO_API = "https://api.apollo.io/v1";

function getApolloKey(): string | null {
  // Prefer master key (full API access) over standard key
  if (process.env.APOLLO_MASTER_KEY) return process.env.APOLLO_MASTER_KEY;
  if (process.env.APOLLO_API_KEY) return process.env.APOLLO_API_KEY;

  // Check connector config in DB
  const tenantId = getTenantId();
  const conn = db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.name, "apollo-prospecting")))
    .get();

  if (conn?.config) {
    try {
      const cfg = JSON.parse(conn.config);
      return cfg.masterKey || cfg.apiKey || null;
    } catch {}
  }
  return null;
}

async function apolloFetch(path: string, body?: Record<string, unknown>): Promise<unknown> {
  const apiKey = getApolloKey();
  if (!apiKey) {
    throw new Error("Apollo API key not configured");
  }

  const res = await fetch(`${APOLLO_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "User-Agent": "curl/8.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo API ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── POST /api/integrations/apollo ────────────────────────────────────────
// Dispatches to: match | enrich | search based on `action` field.
// Default action is "match" (most reliable with standard/master keys).

const matchSchema = z.object({
  action: z.literal("match").default("match"),
  email: z.string().email().optional(),
  linkedinUrl: z.string().optional(),
  name: z.string().optional(),
  revealPersonalEmails: z.boolean().default(true),
  autoIngest: z.boolean().default(true),
});

const enrichSchema = z.object({
  action: z.literal("enrich").default("enrich"),
  email: z.string().email().optional(),
  linkedinUrl: z.string().optional(),
  autoIngest: z.boolean().default(true),
});

const searchSchema = z.object({
  action: z.literal("search").default("search"),
  query: z.string().optional(),
  title: z.string().optional(),
  companyDomain: z.string().optional(),
  organizationName: z.string().optional(),
  location: z.string().optional(),
  currentPage: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(25),
  autoIngest: z.boolean().default(true),
});

const apolloPostSchema = z.discriminatedUnion("action", [matchSchema, enrichSchema, searchSchema]);

function mapApolloPerson(person: Record<string, any>): ApolloLeadInput {
  return {
    id: String(person.id || ""),
    firstName: person.first_name as string | null,
    lastName: person.last_name as string | null,
    name: person.name as string | null,
    title: person.title as string | null,
    email: person.email as string | null,
    linkedinUrl: person.linkedin_url as string | null,
    companyName: person.organization?.name as string | null,
    companyDomain: person.organization?.primary_domain as string | null,
    companyLinkedinUrl: person.organization?.linkedin_url as string | null,
    summary: person.headline as string | null,
  };
}

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json().catch(() => ({}));
  const parsed = apolloPostSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { action } = parsed.data;

  try {
    if (action === "match") return handleMatch(tenantId, parsed.data);
    if (action === "enrich") return handleMatch(tenantId, { ...parsed.data, action: "match", revealPersonalEmails: true } as z.infer<typeof matchSchema>);
    return handleSearch(tenantId, parsed.data);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Apollo request failed" },
      { status: 502 },
    );
  }
}

// ─── Match (people/match) ────────────────────────────────────────────────
async function handleMatch(tenantId: string, params: z.infer<typeof matchSchema>) {
  const { autoIngest, revealPersonalEmails, action: _, ...matchParams } = params;

  const data = (await apolloFetch("/people/match", {
    ...matchParams,
    reveal_personal_emails: revealPersonalEmails,
  })) as Record<string, unknown>;

  const person = data?.person as Record<string, any> | undefined;
  if (!person) {
    return Response.json({ error: "No person found" }, { status: 404 });
  }

  // Extract personal emails from Apollo's nested format
  const personalEmails = Array.isArray(person.personal_emails)
    ? person.personal_emails
        .filter((pe: any) => typeof pe === "object" && pe.email)
        .map((pe: any) => pe.email)
    : [];

  const contactEmail = person.email || personalEmails[0] || null;

  let ingested = false;
  if (autoIngest) {
    try {
      const lead: ApolloLeadInput = { ...mapApolloPerson(person), email: contactEmail };
      ingestOpportunityCandidate({ tenantId, candidate: mapApolloLeadToCandidate(lead) });
      ingested = true;
    } catch {}
  }

  logAudit({
    action: "integration.apollo.match",
    entity: "integration",
    summary: `Apollo match: ${person.name || params.email || params.linkedinUrl || "unknown"}${personalEmails.length > 0 ? ` (${personalEmails.length} personal emails)` : ""}`,
    source: "operator",
  });

  return Response.json({ person, personalEmails, contactEmail, ingested });
}

// ─── Search (people/search) ───────────────────────────────────────────────
async function handleSearch(tenantId: string, params: z.infer<typeof searchSchema>) {
  const { autoIngest, action: _, ...searchParams } = params;

  const data = (await apolloFetch("/people/search", {
    ...searchParams,
    person_titles: searchParams.title ? [searchParams.title] : undefined,
  })) as Record<string, any>;

  const people = (data?.people || []) as Array<Record<string, any>>;
  const total = (data?.pagination?.total_entries as number) || 0;

  let ingested = 0;
  let ingestErrors = 0;

  if (autoIngest && people.length > 0) {
    for (const person of people) {
      try {
        ingestOpportunityCandidate({
          tenantId,
          candidate: mapApolloLeadToCandidate(mapApolloPerson(person)),
        });
        ingested++;
      } catch {
        ingestErrors++;
      }
    }
  }

  logAudit({
    action: "integration.apollo.search",
    entity: "integration",
    summary: `Apollo search: "${params.query || params.title || "n/a"}" → ${people.length} results (${ingested} ingested)`,
    source: "operator",
    metadata: { query: params.query, title: params.title, total, returned: people.length, ingested },
  });

  return Response.json({ people, pagination: data?.pagination || {}, total, ingested, ingestErrors });
}

// ─── GET /api/integrations/apollo/status ───────────────────────────────────
export async function GET() {
  const apiKey = getApolloKey();
  return Response.json({
    configured: !!apiKey,
    source: apiKey
      ? process.env.APOLLO_MASTER_KEY ? "env:master"
        : process.env.APOLLO_API_KEY ? "env:standard"
        : "connector"
      : null,
  });
}
