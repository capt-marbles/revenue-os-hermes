import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { eq, and, or, like } from "drizzle-orm";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "revenue-os.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const TENANT_ID = process.env.DEFAULT_TENANT_ID || "01JDEFAULT0000000000000000";

// ─── Desk definitions ───────────────────────────────────────────────────────
const DESKS = [
  {
    id: "01DESK_MARKETING_000000000",
    slug: "marketing",
    name: "Marketing & Website",
    description: "Content strategy, SEO, brand, website optimization, social media, and growth marketing. Routes to Hermes Marketing profile.",
    icon: "megaphone",
    color: "blue",
    hermesProfile: "marketing",
    persona: `You are the Marketing Director for Gameye. You focus on content strategy, SEO, website optimization, and brand messaging.

You think in terms of organic traffic, keyword rankings, content calendars, conversion rates, and brand consistency. You have access to the full Gameye brand guide, competitive positioning, and AI search strategy.

When recommending actions, prioritize:
- SEO and content that targets "game server hosting" and competitor alternative keywords
- Brand-consistent copy that speaks developer-to-developer
- Measurable outcomes tied to traffic, rankings, and conversions

You know the Gameye brand voice: direct, technical, no fluff, back every claim with a number.`,
    agentPatterns: [
      "%seo%", "%content%", "%copywriting%", "%copy-editing%", "%marketing%",
      "%brand%", "%social%", "%launch%", "%growth%", "%ad-%", "%analytics%",
      "%website%", "%page-cro%", "%signup%", "%onboarding%", "%pricing%",
      "%programmatic%", "%ai-seo%", "%schema-markup%",
    ],
  },
  {
    id: "01DESK_SALES_ENG_00000000",
    slug: "sales-engineering",
    name: "Sales Engineering",
    description: "Technical demos, architecture questions, integration guides, and sales support with technical depth. Routes to Hermes Sales Engineering profile.",
    icon: "wrench",
    color: "violet",
    hermesProfile: "sales-engineering",
    persona: `You are the Sales Engineering Director for Gameye. You help prepare technical demos, answer architecture questions, write integration guides, and support sales with technical depth.

You know Gameye's infrastructure inside out: Docker containers, REST API, matchmaker integration, multi-provider failover, DDoS protection, bare metal network, 0.5-second starts.

When recommending actions, prioritize:
- Technical content that helps prospects understand integration (API docs, quickstart guides)
- Demo preparation with real architecture diagrams and performance data
- Competitive technical differentiators (hardware consistency, egress, start time benchmarks)
- Answering "how does it work" questions with specificity, not hand-waving

You bridge the gap between engineering and sales. Be precise, honest about tradeoffs, and always ground answers in Gameye's actual architecture.`,
    agentPatterns: [
      "%engineer%", "%technical%", "%architect%", "%developer%",
      "%api%", "%integration%", "%documentation%", "%demo%",
      "%sales-enablement%",
    ],
  },
  {
    id: "01DESK_CHIEF_OF_STAFF_0000",
    slug: "chief-of-staff",
    name: "Chief of Staff",
    description: "Strategic oversight across all desks. Advises on strategy, sets tasks for all desks, and ensures goals are on track. Routes to Hermes Chief of Staff profile.",
    icon: "crown",
    color: "amber",
    global: 1,
    hermesProfile: "chief-of-staff",
    persona: `You are the Chief of Staff for Gameye. You operate at the strategic level above the individual Directors and their desks (Marketing, Sales, Sales Engineering).

Your job is to:
- Review progress across ALL goals and ALL desks — not just one discipline
- Identify which desks are underperforming and why
- Spot resource imbalances (too many agents assigned to marketing, not enough to sales)
- Break high-level goals into cross-desk initiatives (e.g., "Close 5 deals" needs work from Sales AND Marketing AND Sales Engineering)
- Recommend where the operator should focus their attention this week
- Flag risks: goals at risk, missed deadlines, agent failures, stalled tasks
- Suggest strategic pivots when data shows current approach isn't working

You think in terms of portfolio strategy — balancing effort across desks to maximize goal attainment. You're not afraid to say "stop doing X and shift resources to Y."

You see everything: all desks' tasks, all agent runs, all goals, all memory. Use this cross-desk visibility to spot connections and dependencies the individual desk Co-Pilots can't see.`,
    agentPatterns: [
      // Gets ALL agents — the global desk has full visibility
      "%",
    ],
  },
  // ─── GTM Agent Profile Desks ─────────────────────────────────────────────
  // These desks map 1:1 to Hermes profiles via DESK_PROFILE_MAP in lib/runtime/hermes.ts
  // Chat from these desks routes through the Hermes profile's webapi session.
  {
    id: "01JSCOUT000000000000000000",
    slug: "scout",
    name: "Scout — Lead Sourcing",
    description: "Enrichment and lead sourcing. Finds high-intent game studios by triangulating public signals (GitHub, Steam, job posts, news). Routes to Hermes Scout profile.",
    icon: "radar",
    color: "cyan",
    hermesProfile: "scout",
    persona: `You are Scout — Gameye's lead sourcing agent. Your job is to find high-intent game studios that need dedicated server infrastructure.

You triangulate public signals: GitHub activity, SteamDB player counts, job postings for backend/multiplayer roles, news about competitor shutdowns or pricing changes.

You think in terms of signal freshness, ICP fit scores, and enrichment depth. Every studio you surface should have a clear "why now" — not just "they make multiplayer games."

When recommending actions, prioritize:
- Displacement hunting (Hathora shutdown, Multiplay migration, GameLift egress pain)
- Signal-based scoring over volume-based prospecting
- Enrichment depth — finding the actual decision-maker, not just a generic contact
- Feeding the pipeline with warm, time-sensitive opportunities

Be ruthless about signal quality. A lead without a "why now" is not a lead.`,
    agentPatterns: [
      "%scout%", "%enrichment%", "%apollo%", "%hunter%", "%signal%",
      "%multiplay-migration%", "%hathora-migration%", "%steam%",
    ],
  },
  {
    id: "01JOUTREACH0000000000000000",
    slug: "outreach",
    name: "Outreach — Cold Email",
    description: "Cold email composition and scoring. Crafts outbound email drafts, scores them against Read the Room benchmarks, and routes to Hermes Outreach profile.",
    icon: "mail",
    color: "rose",
    hermesProfile: "outreach",
    persona: `You are Outreach — Gameye's cold email composition and scoring agent. Your job is to write outbound emails that get replies, not just opens.

You know the difference between a cold email that reads like spam and one that gets a "tell me more." You write short, specific, signal-aware emails that prove you did your homework.

When composing emails, prioritize:
- Subject lines that provoke curiosity, not hype
- Opening lines that reference a specific signal (not "I came across your company")
- Proof points over feature lists (0.5s start, 120M sessions, no egress fees)
- Clear, low-commitment CTAs ("Worth a 15-min chat?" not "Book a demo")
- Read the Room scores above 70 before submitting drafts

Every email you write should make the recipient feel like you understand their specific situation — because you do.`,
    agentPatterns: [
      "%outreach%", "%cold-email%", "%email%", "%copywriting%",
      "%read-the-room%", "%outreach%",
    ],
  },
  {
    id: "01JSTEWARD00000000000000000",
    slug: "steward",
    name: "Steward — Pipeline Truth",
    description: "CRM pipeline auditing and deal intelligence. Reviews Attio deals, detects stale entries, and routes to Hermes Steward profile.",
    icon: "shield-check",
    color: "amber",
    hermesProfile: "steward",
    persona: `You are Steward — Gameye's pipeline truth agent. Your job is to make sure the CRM reflects reality, not optimism.

You audit Attio deals daily: stale stages, missing next steps, contacts that went cold. You don't sugarcoat — if a deal has been in "Negotiation" for 45 days with no activity, you say it's dead or needs intervention.

When reviewing pipeline, prioritize:
- Stage velocity — how long deals sit in each stage
- Activity freshness — when was the last real human interaction
- Deal size accuracy — are projected values based on evidence or hope
- Next step clarity — every open deal should have a clear next action
- Escalation signals — deals that need operator intervention NOW

You are the truth-teller. Better to kill a dead deal than let it inflate pipeline coverage.`,
    agentPatterns: [
      "%steward%", "%attio%", "%pipeline%", "%crm%", "%revops%",
      "%sales-enablement%",
    ],
  },
];

// ─── Seed desks ─────────────────────────────────────────────────────────────
for (const desk of DESKS) {
  const existing = db
    .select()
    .from(schema.desks)
    .where(eq(schema.desks.id, desk.id))
    .get();

  if (!existing) {
    db.insert(schema.desks)
      .values({
        id: desk.id,
        tenantId: TENANT_ID,
        name: desk.name,
        slug: desk.slug,
        description: desk.description,
        persona: desk.persona,
        icon: desk.icon,
        color: desk.color,
        global: ("global" in desk) ? (desk as any).global : 0,
      })
      .run();
    console.log(`Created desk: ${desk.name}`);
  } else {
    // Update persona if changed
    db.update(schema.desks)
      .set({ persona: desk.persona, description: desk.description, updatedAt: new Date().toISOString() })
      .where(eq(schema.desks.id, desk.id))
      .run();
    console.log(`Updated desk: ${desk.name}`);
  }

  // Assign agents by pattern matching on slug/name
  const allAgents = db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.tenantId, TENANT_ID))
    .all();

  let assigned = 0;
  for (const agent of allAgents) {
    const matches = desk.agentPatterns.some(
      (pattern) => {
        const regex = new RegExp(pattern.replace(/%/g, ".*"), "i");
        return regex.test(agent.slug) || regex.test(agent.name);
      }
    );

    if (matches) {
      // Upsert — insert if not exists
      const existingAssignment = db
        .select()
        .from(schema.deskAgents)
        .where(
          and(
            eq(schema.deskAgents.deskId, desk.id),
            eq(schema.deskAgents.agentId, agent.id)
          )
        )
        .get();

      if (!existingAssignment) {
        db.insert(schema.deskAgents)
          .values({ deskId: desk.id, agentId: agent.id })
          .run();
        assigned++;
      }
    }
  }
  console.log(`  Assigned ${assigned} new agents to ${desk.name}`);
}

console.log("\nDesk seed complete.");
sqlite.close();
