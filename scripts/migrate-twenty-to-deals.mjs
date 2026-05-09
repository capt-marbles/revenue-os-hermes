#!/usr/bin/env node
// Migrates Twenty CRM opportunities → local deals table

import Database from "better-sqlite3";
import { ulid } from "ulid";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../data/revenue-os.db");

const TWENTY_BASE_URL = process.env.TWENTY_BASE_URL || "http://localhost:3010";
const TWENTY_API_KEY = process.env.TWENTY_API_KEY;
const TENANT_ID = process.env.DEFAULT_TENANT_ID || "01JDEFAULT0000000000000000";

if (!TWENTY_API_KEY) {
  console.error("Set TWENTY_API_KEY env var");
  process.exit(1);
}

// Map Twenty stages → internal pipeline stages
const STAGE_MAP = {
  TARGET_ACCOUNT:        "discovered",
  SIGNAL_RECEIVED:       "enriched",
  REACHOUT:              "synced",
  CONNECTED:             "connected",
  SCREENING:             "demo_scheduled",
  TECHNICAL_EVALUATION:  "technical_evaluation",
  PROPOSAL:              "demo_completed",
  NEGOTIATION:           "evaluation_period",
  COMMITTED:             "committed",
  NURTURE:               "discovered",
  ON_HOLD:               "discovered",
  WON:                   "won",
  LOST:                  "lost",
};

async function fetchAll(resource) {
  const results = [];
  let cursor = null;
  while (true) {
    const params = new URLSearchParams({ limit: "100", order_by: "createdAt[AscNullsLast]" });
    if (cursor) params.set("starting_after", cursor);
    const res = await fetch(`${TWENTY_BASE_URL}/rest/${resource}?${params}`, {
      headers: { Authorization: `Bearer ${TWENTY_API_KEY}` },
    });
    if (!res.ok) throw new Error(`GET ${resource} failed: ${res.status}`);
    const json = await res.json();
    const records = json.data?.[resource] ?? [];
    results.push(...records);
    const pageInfo = json.data?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }
  return results;
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  console.log("Fetching data from Twenty...");
  const [opportunities, companies, people] = await Promise.all([
    fetchAll("opportunities"),
    fetchAll("companies"),
    fetchAll("people"),
  ]);

  console.log(`  ${opportunities.length} opportunities, ${companies.length} companies, ${people.length} people`);

  const companyMap = new Map(companies.map((c) => [c.id, c.name]));
  const personMap  = new Map(people.map((p) => [
    p.id,
    {
      name: [p.name?.firstName, p.name?.lastName].filter(Boolean).join(" "),
      email: p.emails?.primaryEmail ?? null,
    },
  ]));

  const insert = db.prepare(`
    INSERT OR IGNORE INTO deals
      (id, tenant_id, name, stage, sales_motion, contact_name, contact_email,
       close_date, mrr, revenue_date, studio_name, notes, position, twenty_id,
       created_at, updated_at)
    VALUES
      (@id, @tenantId, @name, @stage, @salesMotion, @contactName, @contactEmail,
       @closeDate, @mrr, @revenueDate, @studioName, @notes, @position, @twentyId,
       @createdAt, @updatedAt)
  `);

  const logActivity = db.prepare(`
    INSERT INTO deal_activities (id, deal_id, content, type, created_at)
    VALUES (@id, @dealId, @content, @type, @createdAt)
  `);

  const insertMany = db.transaction((opps) => {
    let migrated = 0, skipped = 0;
    for (const [i, opp] of opps.entries()) {
      const stage = STAGE_MAP[opp.stage] ?? "discovered";
      const contact = opp.pointOfContactId ? personMap.get(opp.pointOfContactId) : null;
      const studioName = opp.companyId ? companyMap.get(opp.companyId) ?? null : null;
      const mrr = opp.amount?.amountMicros ? opp.amount.amountMicros / 1e6 : null;

      const deal = {
        id:           ulid(),
        tenantId:     TENANT_ID,
        name:         opp.name || "Untitled",
        stage,
        salesMotion:  "outbound",
        contactName:  contact?.name || null,
        contactEmail: contact?.email || null,
        closeDate:    opp.closeDate ? opp.closeDate.slice(0, 10) : null,
        mrr,
        revenueDate:  null,
        studioName,
        notes:        null,
        position:     i,
        twentyId:     opp.id,
        createdAt:    opp.createdAt ?? new Date().toISOString(),
        updatedAt:    opp.updatedAt ?? new Date().toISOString(),
      };

      const result = insert.run(deal);
      if (result.changes > 0) {
        logActivity.run({
          id: ulid(),
          dealId: deal.id,
          content: `Migrated from Twenty CRM (stage: ${opp.stage ?? "unknown"})`,
          type: "note",
          createdAt: deal.createdAt,
        });
        migrated++;
        process.stdout.write(".");
      } else {
        skipped++;
        process.stdout.write("~");
      }
    }
    return { migrated, skipped };
  });

  const { migrated, skipped } = insertMany(opportunities);
  console.log(`\n\nDone. Migrated: ${migrated}, already existed (skipped): ${skipped}`);
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
