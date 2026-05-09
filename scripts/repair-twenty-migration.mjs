#!/usr/bin/env node
/**
 * Repair Attio → Twenty CRM migration
 *
 * What went wrong: the original migration imported 159 orphaned opportunities
 * with no company/contact links, wrong stages, missing names and values.
 *
 * This script:
 * 1. Reads all 158 deals from Attio (source of truth)
 * 2. Builds Attio company ID → company name lookup
 * 3. Builds Twenty company name → Twenty ID lookup (8,870 companies)
 * 4. Fetches Attio person records for deal contacts, gets their emails
 * 5. Builds Twenty person email → Twenty ID lookup (13,153 people)
 * 6. Deletes all 159 broken Twenty opportunities
 * 7. Re-creates all 158 from Attio with proper relationships
 */

import fs from "fs";
import path from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const ATTIO_API = "https://api.attio.com/v2";
const TWENTY_API = "https://api.twenty.com";

function loadSecrets() {
  const secretsPath = path.join(process.env.HOME, ".hermes", "secrets.env");
  const lines = fs.readFileSync(secretsPath, "utf-8").split("\n");
  const secrets = {};
  for (const line of lines) {
    const [key, ...rest] = line.trim().split("=");
    if (key && !key.startsWith("#") && rest.length) {
      secrets[key.trim()] = rest.join("=").trim();
    }
  }
  return secrets;
}

const secrets = loadSecrets();
const ATTIO_KEY = secrets.ATTIO_API_KEY;
const TWENTY_KEY = secrets.TWENTY_API_KEY;

if (!ATTIO_KEY) throw new Error("ATTIO_API_KEY not found in ~/.hermes/secrets.env");
if (!TWENTY_KEY) throw new Error("TWENTY_API_KEY not found in ~/.hermes/secrets.env");

// ─── Stage mapping ────────────────────────────────────────────────────────────

// Valid Twenty OpportunityStageEnum values:
// TARGET_ACCOUNT, SIGNAL_RECEIVED, REACHOUT, CONNECTED,
// TECHNICAL_EVALUATION, COMMITTED, WON, LOST
const STAGE_MAP = {
  "Target Account":            "TARGET_ACCOUNT",
  "Signal Detected/New Lead":  "SIGNAL_RECEIVED",
  "Reachout Sent":             "REACHOUT",
  "Demo Scheduled":            "DEMO_SCHEDULED",
  "Demo Completed":            "DEMO_COMPLETED",
  "Evaluation Period":         "EVALUATION_PERIOD",
  "Technical Evaluation/PoC":  "TECHNICAL_EVALUATION",
  "Connected":                 "CONNECTED",
  "Won 🎉":                   "WON",
  "Lost":                      "LOST",
  "On Hold":                   "CONNECTED",  // closest available
  "Committed":                 "COMMITTED",
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function attioGet(path) {
  const res = await fetch(`${ATTIO_API}${path}`, {
    headers: { Authorization: `Bearer ${ATTIO_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Attio GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function attioPost(path, body) {
  const res = await fetch(`${ATTIO_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ATTIO_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Attio POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function twentyGet(path) {
  const res = await fetch(`${TWENTY_API}${path}`, {
    headers: { Authorization: `Bearer ${TWENTY_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Twenty GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function twentyPost(path, body) {
  const res = await fetch(`${TWENTY_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TWENTY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Twenty POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function twentyDelete(path) {
  const res = await fetch(`${TWENTY_API}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TWENTY_KEY}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Twenty DELETE ${path} → ${res.status}: ${await res.text()}`);
  }
}

// ─── Pagination helpers ───────────────────────────────────────────────────────

async function fetchAllTwenty(endpoint, maxRecords = 20000) {
  const results = [];
  const seen = new Set();
  let cursor = null;
  let page = 0;
  while (true) {
    const url = cursor
      ? `${endpoint}&after=${encodeURIComponent(cursor)}`
      : endpoint;

    let data;
    // Retry with back-off on rate limit
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        data = await twentyGet(url);
        break;
      } catch (err) {
        if (err.message.includes("429") && attempt < 4) {
          const wait = (attempt + 1) * 15000;
          process.stdout.write(`\r  rate limited, waiting ${wait/1000}s...`);
          await new Promise(r => setTimeout(r, wait));
        } else throw err;
      }
    }

    const key = Object.keys(data.data ?? {})[0];
    const records = data.data?.[key] ?? [];
    let newCount = 0;
    for (const rec of records) {
      if (!seen.has(rec.id)) {
        seen.add(rec.id);
        results.push(rec);
        newCount++;
      }
    }
    page++;
    process.stdout.write(`\r  page ${page}, ${results.length} unique records...`);

    // Stop if no new records (pagination loop) or no next page or hit max
    if (!data.pageInfo?.hasNextPage || newCount === 0 || results.length >= maxRecords) break;
    cursor = data.pageInfo.endCursor;
    await new Promise(r => setTimeout(r, 200));
  }
  process.stdout.write("\n");
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Twenty CRM Migration Repair ===\n");

  // ── Step 1: Fetch all Attio deals ──────────────────────────────────────────
  console.log("Step 1: Fetching all Attio deals...");
  const attioDealsResp = await attioPost("/objects/deals/records/query", { limit: 500 });
  const attioDeals = attioDealsResp.data ?? [];
  console.log(`  Found ${attioDeals.length} deals in Attio`);

  // ── Step 2: Collect unique Attio company/person IDs ───────────────────────
  const attioCompanyIds = new Set();
  const attioPersonIds = new Set();

  for (const deal of attioDeals) {
    const v = deal.values;
    for (const ref of (v.associated_company ?? [])) {
      if (ref.target_record_id) attioCompanyIds.add(ref.target_record_id);
    }
    for (const ref of (v.associated_people ?? [])) {
      if (ref.target_record_id) attioPersonIds.add(ref.target_record_id);
    }
  }
  console.log(`  Unique Attio companies referenced: ${attioCompanyIds.size}`);
  console.log(`  Unique Attio people referenced: ${attioPersonIds.size}`);

  // ── Step 3: Fetch Attio company names ─────────────────────────────────────
  console.log("\nStep 2: Fetching Attio company names...");
  const attioCompanyNameById = {};
  const companyIdArray = [...attioCompanyIds];

  for (let i = 0; i < companyIdArray.length; i++) {
    const id = companyIdArray[i];
    try {
      const resp = await attioGet(`/objects/companies/records/${id}`);
      const nameVal = resp.data?.values?.name?.[0]?.value;
      if (nameVal) attioCompanyNameById[id] = nameVal;
    } catch {
      // skip unresolvable
    }
    process.stdout.write(`\r  ${i + 1}/${companyIdArray.length}`);
    await new Promise(r => setTimeout(r, 80));
  }
  process.stdout.write("\n");
  console.log(`  Resolved ${Object.keys(attioCompanyNameById).length} company names`);

  // ── Step 4: Fetch Attio person emails ─────────────────────────────────────
  console.log("\nStep 3: Fetching Attio person emails...");
  const attioPersonEmailById = {};
  const personIdArray = [...attioPersonIds];

  for (let i = 0; i < personIdArray.length; i++) {
    const id = personIdArray[i];
    try {
      const resp = await attioGet(`/objects/people/records/${id}`);
      const emailVals = resp.data?.values?.email_addresses ?? [];
      const email = emailVals[0]?.email_address;
      if (email) attioPersonEmailById[id] = email;
    } catch {
      // skip
    }
    process.stdout.write(`\r  ${i + 1}/${personIdArray.length}`);
    await new Promise(r => setTimeout(r, 80));
  }
  process.stdout.write("\n");
  console.log(`  Resolved ${Object.keys(attioPersonEmailById).length} person emails`);

  // ── Step 5: Build Twenty company lookup by name (direct search, avoids pagination bug) ──
  console.log("\nStep 4: Looking up Twenty company IDs by name...");
  const twentyCompanyByName = {};
  const uniqueCompanyNames = [...new Set(Object.values(attioCompanyNameById))];
  let coLookupDone = 0;
  for (const name of uniqueCompanyNames) {
    const encoded = encodeURIComponent(name);
    try {
      const data = await twentyGet(`/rest/companies?filter=name[eq]:${encoded}&limit=1`);
      const co = data.data?.companies?.[0];
      if (co?.id) twentyCompanyByName[name.toLowerCase().trim()] = co.id;
    } catch (err) {
      if (err.message.includes("429")) {
        await new Promise(r => setTimeout(r, 15000));
        try {
          const data = await twentyGet(`/rest/companies?filter=name[eq]:${encoded}&limit=1`);
          const co = data.data?.companies?.[0];
          if (co?.id) twentyCompanyByName[name.toLowerCase().trim()] = co.id;
        } catch { /* skip */ }
      }
    }
    coLookupDone++;
    if (coLookupDone % 10 === 0) process.stdout.write(`\r  ${coLookupDone}/${uniqueCompanyNames.length} looked up...`);
    await new Promise(r => setTimeout(r, 300));
  }
  process.stdout.write(`\r  ${coLookupDone}/${uniqueCompanyNames.length} looked up\n`);
  console.log(`  Matched ${Object.keys(twentyCompanyByName).length}/${uniqueCompanyNames.length} companies`);

  // ── Step 6: Build Twenty person lookup by email (direct search) ───────────
  console.log("\nStep 5: Looking up Twenty person IDs by email...");
  const twentyPersonByEmail = {};
  const uniqueEmails = [...new Set(Object.values(attioPersonEmailById))];
  let pLookupDone = 0;
  for (const email of uniqueEmails) {
    const encoded = encodeURIComponent(email);
    try {
      const data = await twentyGet(`/rest/people?filter=emails.primaryEmail[eq]:${encoded}&limit=1`);
      const person = data.data?.people?.[0];
      if (person?.id) twentyPersonByEmail[email.toLowerCase().trim()] = person.id;
    } catch (err) {
      if (err.message.includes("429")) {
        await new Promise(r => setTimeout(r, 15000));
        try {
          const data = await twentyGet(`/rest/people?filter=emails.primaryEmail[eq]:${encoded}&limit=1`);
          const person = data.data?.people?.[0];
          if (person?.id) twentyPersonByEmail[email.toLowerCase().trim()] = person.id;
        } catch { /* skip */ }
      }
    }
    pLookupDone++;
    if (pLookupDone % 10 === 0) process.stdout.write(`\r  ${pLookupDone}/${uniqueEmails.length} looked up...`);
    await new Promise(r => setTimeout(r, 300));
  }
  process.stdout.write(`\r  ${pLookupDone}/${uniqueEmails.length} looked up\n`);
  console.log(`  Matched ${Object.keys(twentyPersonByEmail).length}/${uniqueEmails.length} people`);

  // ── Step 7: Fetch all existing Twenty opportunities to delete ─────────────
  console.log("\nStep 6: Fetching existing Twenty opportunities to delete...");
  const existingOpps = await fetchAllTwenty("/rest/opportunities?limit=500&order_by=createdAt[AscNullsFirst]");
  console.log(`  Found ${existingOpps.length} existing opportunities`);

  console.log("  Deleting all existing opportunities...");
  let deleted = 0;
  for (const opp of existingOpps) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await twentyDelete(`/rest/opportunities/${opp.id}`);
        break;
      } catch (err) {
        if (err.message.includes("429") && attempt < 3) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 10000));
        } else throw err;
      }
    }
    deleted++;
    if (deleted % 10 === 0) process.stdout.write(`\r  deleted ${deleted}/${existingOpps.length}`);
    await new Promise(r => setTimeout(r, 400));
  }
  process.stdout.write(`\r  deleted ${deleted}/${existingOpps.length}\n`);

  // ── Step 8: Re-create from Attio ──────────────────────────────────────────
  console.log("\nStep 7: Re-creating opportunities from Attio...");
  const results = { created: 0, errors: [], noCompany: 0, noContact: 0 };

  for (const deal of attioDeals) {
    const v = deal.values;
    const name = v.name?.[0]?.value ?? "Untitled";
    const attioStage = v.stage?.[0]?.status?.title ?? "Target Account";
    const stage = STAGE_MAP[attioStage] ?? "TARGET_ACCOUNT";
    const createdAt = v.created_at?.[0]?.value ?? deal.created_at;

    // MRR (estimatedMrr) and deal value (amount)
    const mrrEntry = v.estimated_mrr?.[0];
    const valEntry = v.value?.[0];
    const closeEntry = v.close_date?.[0];

    // Resolve Twenty company ID
    const attioCompanyId = v.associated_company?.[0]?.target_record_id;
    const companyName = attioCompanyId ? attioCompanyNameById[attioCompanyId] : null;
    let twentyCompanyId = null;
    if (companyName) {
      twentyCompanyId = twentyCompanyByName[companyName.toLowerCase().trim()] ?? null;
      if (!twentyCompanyId) {
        // Try partial match (first word)
        const firstWord = companyName.toLowerCase().split(/[\s-]/)[0];
        const candidate = Object.entries(twentyCompanyByName)
          .find(([k]) => k.startsWith(firstWord));
        if (candidate) twentyCompanyId = candidate[1];
      }
    }
    if (!twentyCompanyId) results.noCompany++;

    // Resolve Twenty person ID via email
    const attioPersonId = v.associated_people?.[0]?.target_record_id;
    const personEmail = attioPersonId ? attioPersonEmailById[attioPersonId] : null;
    let twentyPersonId = null;
    if (personEmail) {
      twentyPersonId = twentyPersonByEmail[personEmail.toLowerCase().trim()] ?? null;
    }
    if (!twentyPersonId) results.noContact++;

    const body = {
      name,
      stage,
      ...(twentyCompanyId ? { companyId: twentyCompanyId } : {}),
      ...(twentyPersonId ? { pointOfContactId: twentyPersonId } : {}),
      ...(mrrEntry ? {
        estimatedMrr: {
          amountMicros: Math.round(mrrEntry.currency_value * 1_000_000),
          currencyCode: mrrEntry.currency_code ?? "USD",
        },
      } : {}),
      ...(valEntry ? {
        amount: {
          amountMicros: Math.round(valEntry.currency_value * 1_000_000),
          currencyCode: valEntry.currency_code ?? "USD",
        },
      } : {}),
      ...(closeEntry ? { closeDate: closeEntry.value?.split("T")[0] ?? null } : {}),
    };

    let created = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await twentyPost("/rest/opportunities", body);
        created = true;
        break;
      } catch (err) {
        if (err.message.includes("429") && attempt < 3) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 10000));
        } else {
          results.errors.push({ deal: name, error: err.message });
          break;
        }
      }
    }
    if (created) {
      results.created++;
      if (results.created % 5 === 0) {
        process.stdout.write(`\r  created ${results.created}/${attioDeals.length}`);
      }
    }

    await new Promise(r => setTimeout(r, 400));
  }
  process.stdout.write(`\r  created ${results.created}/${attioDeals.length}\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=== Results ===");
  console.log(`  Opportunities created:    ${results.created}/${attioDeals.length}`);
  console.log(`  Errors:                   ${results.errors.length}`);
  console.log(`  No company match:         ${results.noCompany}`);
  console.log(`  No contact match:         ${results.noContact}`);

  if (results.errors.length) {
    console.log("\nErrors:");
    for (const e of results.errors) {
      console.log(`  - ${e.deal}: ${e.error}`);
    }
  }
}

main().catch(err => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
