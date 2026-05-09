import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { ulid } from "ulid";

const dbPath = path.join(process.cwd(), "data", "revenue-os.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const TENANT_ID = process.env.DEFAULT_TENANT_ID || "01JDEFAULT0000000000000000";
const BRAND_REPO = process.env.GAMEYE_BRAND_PATH || path.join(process.env.HOME || "", "projects", "gameye-brand");

function upsertMemory(category: string, key: string, value: string, updatedBy: string = "import") {
  const existing = db
    .select()
    .from(schema.sharedMemory)
    .where(
      and(
        eq(schema.sharedMemory.tenantId, TENANT_ID),
        eq(schema.sharedMemory.category, category),
        eq(schema.sharedMemory.key, key)
      )
    )
    .get();

  if (existing) {
    db.update(schema.sharedMemory)
      .set({ value, updatedBy, updatedAt: new Date().toISOString() })
      .where(eq(schema.sharedMemory.id, existing.id))
      .run();
    console.log(`  Updated: ${category}/${key}`);
  } else {
    db.insert(schema.sharedMemory)
      .values({
        id: ulid(),
        tenantId: TENANT_ID,
        category,
        key,
        value,
        updatedBy,
      })
      .run();
    console.log(`  Created: ${category}/${key}`);
  }
}

// ─── Import brand.md ────────────────────────────────────────────────────────
const brandFile = path.join(BRAND_REPO, "brand.md");
if (fs.existsSync(brandFile)) {
  const content = fs.readFileSync(brandFile, "utf-8");

  // Split into logical sections for targeted injection
  const sections = content.split(/^## /m).filter(Boolean);

  // Full brand doc as one entry
  upsertMemory("brand_voice", "primary", content);

  // Extract key sections into their own entries for targeted use
  for (const section of sections) {
    const firstLine = section.split("\n")[0].trim();
    const sectionContent = `## ${section}`;

    if (firstLine.includes("One-line description")) {
      upsertMemory("brand_voice", "one_liner", sectionContent);
    } else if (firstLine.includes("Value proposition")) {
      upsertMemory("brand_voice", "value_proposition", sectionContent);
    } else if (firstLine.includes("Key facts")) {
      upsertMemory("brand_voice", "proof_points", sectionContent);
    } else if (firstLine.includes("Infrastructure")) {
      upsertMemory("technical_docs", "infrastructure", sectionContent);
    } else if (firstLine.includes("Pricing")) {
      upsertMemory("brand_voice", "pricing", sectionContent);
    } else if (firstLine.includes("Target customer")) {
      upsertMemory("icp", "primary", sectionContent);
    } else if (firstLine.includes("Key assumptions")) {
      upsertMemory("technical_docs", "assumptions", sectionContent);
    } else if (firstLine.includes("Pain points")) {
      upsertMemory("icp", "pain_points", sectionContent);
    } else if (firstLine.includes("Competitive positioning")) {
      upsertMemory("competitors", "primary", sectionContent);
    } else if (firstLine.includes("Social proof")) {
      upsertMemory("brand_voice", "social_proof", sectionContent);
    } else if (firstLine.includes("Logo")) {
      upsertMemory("brand_voice", "brand_assets", sectionContent);
    } else if (firstLine.includes("Tone of voice")) {
      upsertMemory("brand_voice", "tone_of_voice", sectionContent);
    }
  }

  console.log("Imported brand.md");
} else {
  console.log(`Brand file not found at ${brandFile}`);
}

// ─── Import ai-search-strategy.md ──────────────────────────────────────────
const aiSearchFile = path.join(BRAND_REPO, "ai-search-strategy.md");
if (fs.existsSync(aiSearchFile)) {
  const content = fs.readFileSync(aiSearchFile, "utf-8");
  upsertMemory("competitors", "ai_search_strategy", content);
  console.log("Imported ai-search-strategy.md");
} else {
  console.log(`AI search strategy file not found at ${aiSearchFile}`);
}

// ─── Import any future knowledge files ──────────────────────────────────────
const knowledgeDir = path.join(BRAND_REPO, "knowledge");
if (fs.existsSync(knowledgeDir)) {
  const categories = fs.readdirSync(knowledgeDir);
  for (const category of categories) {
    const catDir = path.join(knowledgeDir, category);
    if (!fs.statSync(catDir).isDirectory()) continue;

    const files = fs.readdirSync(catDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(catDir, file), "utf-8");
      const key = file.replace(/\.md$/, "");

      // Map knowledge subdirectory names to memory categories
      const categoryMap: Record<string, string> = {
        brand: "brand_voice",
        company: "brand_voice",
        competitive: "competitors",
        product: "technical_docs",
        sales: "icp",
        technical: "technical_docs",
      };

      const memoryCategory = categoryMap[category] || "custom";
      upsertMemory(memoryCategory, `knowledge_${category}_${key}`, content);
    }
  }
  console.log("Scanned knowledge directory.");
}

console.log("\nBrand import complete.");
sqlite.close();
