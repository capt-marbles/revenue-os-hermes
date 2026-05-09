#!/usr/bin/env node
/**
 * Patch Twenty CRM opportunities:
 * 1. Set ownerId = Andrew Walker on all 158 opportunities
 * 2. Fix the 9 deals with missing companyId via fuzzy name matching
 */

import fs from "fs";
import path from "path";

const ATTIO_API = "https://api.attio.com/v2";
const TWENTY_API = "https://api.twenty.com";

function loadSecrets() {
  const lines = fs.readFileSync(path.join(process.env.HOME, ".hermes", "secrets.env"), "utf-8").split("\n");
  const s = {};
  for (const line of lines) {
    const [k, ...rest] = line.trim().split("=");
    if (k && !k.startsWith("#") && rest.length) s[k.trim()] = rest.join("=").trim();
  }
  return s;
}

const { ATTIO_API_KEY: ATTIO_KEY, TWENTY_API_KEY: TWENTY_KEY } = loadSecrets();
const OWNER_ID = "75c9e6cd-c326-4dd8-909e-fedbdc4e65e1"; // Andrew Walker

async function twentyGet(path) {
  const res = await fetch(`${TWENTY_API}${path}`, {
    headers: { Authorization: `Bearer ${TWENTY_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function twentyPatch(path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${TWENTY_API}${path}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TWENTY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise(r => setTimeout(r, (attempt + 1) * 12000));
      continue;
    }
    if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

async function attioGet(path) {
  const res = await fetch(`${ATTIO_API}${path}`, {
    headers: { Authorization: `Bearer ${ATTIO_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Attio GET ${path} → ${res.status}`);
  return res.json();
}

function normalize(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  const wordsA = new Set(na.split(" "));
  const wordsB = new Set(nb.split(" "));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  return intersection / Math.max(wordsA.size, wordsB.size);
}

async function main() {
  console.log("=== Patching Twenty CRM ===\n");

  // Step 1: Fetch all Twenty opportunities
  console.log("Fetching all opportunities...");
  const data = await twentyGet("/rest/opportunities?limit=200");
  const opps = data.data?.opportunities ?? [];
  console.log(`  Found ${opps.length} opportunities`);

  const missingOwner = opps.filter(o => !o.ownerId);
  const missingCompany = opps.filter(o => !o.companyId);
  console.log(`  Missing owner: ${missingOwner.length}`);
  console.log(`  Missing company: ${missingCompany.length}`);

  // Step 2: Set owner on all opportunities missing one
  console.log(`\nStep 1: Assigning owner (Andrew Walker) to ${missingOwner.length} opportunities...`);
  let ownerPatched = 0, ownerErrors = 0;
  for (const opp of missingOwner) {
    try {
      await twentyPatch(`/rest/opportunities/${opp.id}`, { ownerId: OWNER_ID });
      ownerPatched++;
      if (ownerPatched % 10 === 0) process.stdout.write(`\r  ${ownerPatched}/${missingOwner.length}`);
    } catch (err) {
      ownerErrors++;
      console.log(`\n  Error on ${opp.name}: ${err.message.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 350));
  }
  process.stdout.write(`\r  ${ownerPatched}/${missingOwner.length} patched\n`);

  // Step 3: Fix missing company links via fuzzy matching
  if (missingCompany.length === 0) {
    console.log("\nNo missing company links — skipping.");
  } else {
    console.log(`\nStep 2: Fixing ${missingCompany.length} opportunities with missing company links...`);

    // For each deal missing a company, try Twenty name search with fallback fuzzy
    let coFixed = 0, coFailed = [];
    for (const opp of missingCompany) {
      // Extract probable company name from deal name (strip deal descriptor)
      const rawName = opp.name
        .replace(/ [-—] Infrastructure Deal$/i, "")
        .replace(/ [-—] Hathora (Migration|Outreach)$/i, "")
        .replace(/ [-—] .+$/i, "")
        .trim();

      let twentyId = null;

      // Try exact match first
      try {
        const encoded = encodeURIComponent(rawName);
        const res = await twentyGet(`/rest/companies?filter=name[eq]:${encoded}&limit=1`);
        twentyId = res.data?.companies?.[0]?.id ?? null;
      } catch { /* try fuzzy */ }

      // Try fuzzy: search by first word(s)
      if (!twentyId) {
        const firstWord = rawName.split(/[\s-]/)[0];
        try {
          const encoded = encodeURIComponent(firstWord);
          const res = await twentyGet(`/rest/companies?filter=name[like]:%25${encoded}%25&limit=10`);
          const candidates = res.data?.companies ?? [];
          if (candidates.length) {
            const best = candidates
              .map(c => ({ id: c.id, name: c.name, score: similarity(rawName, c.name) }))
              .sort((a, b) => b.score - a.score)[0];
            if (best.score >= 0.5) twentyId = best.id;
          }
        } catch { /* skip */ }
      }

      if (twentyId) {
        try {
          await twentyPatch(`/rest/opportunities/${opp.id}`, { companyId: twentyId });
          coFixed++;
          console.log(`  ✓ ${opp.name.slice(0,50)} → linked`);
        } catch (err) {
          coFailed.push({ name: opp.name, error: err.message.slice(0, 80) });
        }
      } else {
        coFailed.push({ name: opp.name, error: "no company match found" });
      }
      await new Promise(r => setTimeout(r, 350));
    }

    console.log(`  Fixed: ${coFixed}/${missingCompany.length}`);
    if (coFailed.length) {
      console.log("  Still unlinked:");
      coFailed.forEach(f => console.log(`    - ${f.name}: ${f.error}`));
    }
  }

  // Step 4: Verify final state
  console.log("\nVerifying final state...");
  await new Promise(r => setTimeout(r, 2000));
  const finalData = await twentyGet("/rest/opportunities?limit=200");
  const final = finalData.data?.opportunities ?? [];
  const fOwner = final.filter(o => o.ownerId).length;
  const fCo = final.filter(o => o.companyId).length;
  const fMrr = final.filter(o => o.estimatedMrr?.amountMicros).length;
  const fClose = final.filter(o => o.closeDate).length;
  const fContact = final.filter(o => o.pointOfContactId).length;
  const stages = {};
  for (const o of final) stages[o.stage] = (stages[o.stage] || 0) + 1;

  console.log(`\n=== Final Health Check ===`);
  console.log(`  Total opportunities:  ${final.length}`);
  console.log(`  Named:                ${final.filter(o => o.name).length}/${final.length} (${Math.round(final.filter(o=>o.name).length/final.length*100)}%)`);
  console.log(`  With owner:           ${fOwner}/${final.length} (${Math.round(fOwner/final.length*100)}%)`);
  console.log(`  With company:         ${fCo}/${final.length} (${Math.round(fCo/final.length*100)}%)`);
  console.log(`  With contact:         ${fContact}/${final.length} (${Math.round(fContact/final.length*100)}%)`);
  console.log(`  With MRR >0:          ${fMrr}/${final.length} (${Math.round(fMrr/final.length*100)}%)`);
  console.log(`  With close date:      ${fClose}/${final.length} (${Math.round(fClose/final.length*100)}%)`);
  console.log(`  Stages: ${JSON.stringify(stages, null, 2).replace(/\n/g, '\n  ')}`);
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
