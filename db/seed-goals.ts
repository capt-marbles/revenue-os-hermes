import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import { ulid } from "ulid";

const dbPath = path.join(process.cwd(), "data", "revenue-os.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const TENANT_ID = process.env.DEFAULT_TENANT_ID || "01JDEFAULT0000000000000000";

// ─── Seed Goals ──────────────────────────────────────────────────────────────
const goalsData = [
  {
    id: ulid(),
    tenantId: TENANT_ID,
    title: "Close 5 deals in 90 days",
    description: "Land 5 new paying customers through direct sales outreach, demos, and follow-up sequences. Focus on mid-size game studios with active multiplayer titles.",
    status: "active",
    targetMetric: "deals_closed",
    targetValue: 5,
    currentValue: 0,
    unit: "deals",
    deadline: "2026-07-03", // 90 days from now
    priority: 0,
  },
  {
    id: ulid(),
    tenantId: TENANT_ID,
    title: "Increase MRR by $50K/mo",
    description: "Grow monthly recurring revenue by $50K through new customer acquisition, upsells to existing accounts, and reducing churn. Target: expansion into larger studio accounts.",
    status: "active",
    targetMetric: "mrr_increase",
    targetValue: 50000,
    currentValue: 0,
    unit: "usd",
    deadline: null,
    priority: 1,
  },
  {
    id: ulid(),
    tenantId: TENANT_ID,
    title: "Rank #1 for Multiplay & Hathora alternatives",
    description: "Achieve top organic search position for keywords like 'Multiplay alternative', 'Hathora alternative', 'game server hosting comparison'. Build SEO content, comparison pages, and programmatic landing pages.",
    status: "active",
    targetMetric: "seo_ranking",
    targetValue: 1,
    currentValue: 0,
    unit: "position",
    deadline: null,
    priority: 2,
  },
];

for (const goal of goalsData) {
  const existing = db
    .select()
    .from(schema.goals)
    .where(
      and(
        eq(schema.goals.tenantId, TENANT_ID),
        eq(schema.goals.title, goal.title)
      )
    )
    .get();

  if (!existing) {
    db.insert(schema.goals).values(goal).run();
    console.log(`Seeded goal: ${goal.title}`);
  } else {
    console.log(`Goal already exists: ${goal.title}`);
  }
}

// ─── Update ICP with competitor context ──────────────────────────────────────
const competitorMemory = {
  id: ulid(),
  tenantId: TENANT_ID,
  category: "competitors",
  key: "primary",
  value: `# Competitor Landscape

## Multiplay (Unity)
- Acquired by Unity. Enterprise-focused game server hosting.
- Strengths: Brand recognition, Unity integration, large studio relationships
- Weaknesses: Locked into Unity ecosystem, expensive, slow onboarding, enterprise sales cycles
- Opportunity: Studios frustrated with Unity pricing changes, indies priced out

## Hathora
- Cloud-native game server hosting. Developer-focused.
- Strengths: Modern DX, good docs, serverless model, fast provisioning
- Weaknesses: Younger platform, limited enterprise features, smaller region coverage
- Opportunity: Studios wanting more control, custom infrastructure, dedicated servers

## Gameye Positioning
- **vs Multiplay**: More agile, engine-agnostic, transparent pricing, faster onboarding
- **vs Hathora**: More enterprise-ready, dedicated server support, broader region coverage, proven at scale

## Target SEO Keywords
- "multiplay alternative"
- "hathora alternative"
- "game server hosting comparison"
- "multiplayer server hosting"
- "dedicated game server provider"
- "game server orchestration platform"`,
  updatedBy: "human",
};

const existingComp = db
  .select()
  .from(schema.sharedMemory)
  .where(
    and(
      eq(schema.sharedMemory.tenantId, TENANT_ID),
      eq(schema.sharedMemory.category, "competitors"),
      eq(schema.sharedMemory.key, "primary")
    )
  )
  .get();

if (!existingComp) {
  db.insert(schema.sharedMemory).values(competitorMemory).run();
  console.log("Seeded competitor memory.");
} else {
  console.log("Competitor memory already exists.");
}

// Seed feedback loop schedule (runs daily at 9am)
const FEEDBACK_SCHEDULE_ID = "01FEEDBACKSCHED00000000000";
const existingSchedule = db.select().from(schema.schedules).where(
  eq(schema.schedules.id, FEEDBACK_SCHEDULE_ID)
).get();

if (!existingSchedule) {
  db.insert(schema.schedules).values({
    id: FEEDBACK_SCHEDULE_ID,
    tenantId: TENANT_ID,
    name: "Daily Outreach Feedback Loop",
    description: "Checks for replies to outreach, updates template effectiveness, writes insights to shared memory",
    type: "agent",
    targetId: "01FEEDBACK0000000000000000",
    input: "Run the daily feedback loop: check for new replies to outreach sends from the last 7 days, record responses, compute template effectiveness, and update shared memory with insights.",
    cron: "0 9 * * *",
    timezone: "UTC",
    enabled: 1,
  }).run();
  console.log("Seeded feedback loop schedule.");
}

console.log("Goal seed complete.");
sqlite.close();
