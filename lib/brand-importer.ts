import { db } from "@/db";
import { sharedMemory } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import path from "path";
import fs from "fs";
import { ulid } from "ulid";

function upsertMemory(
  tenantId: string,
  category: string,
  key: string,
  value: string,
  updatedBy: string = "import"
): "created" | "updated" | "unchanged" {
  const existing = db
    .select()
    .from(sharedMemory)
    .where(
      and(
        eq(sharedMemory.tenantId, tenantId),
        eq(sharedMemory.category, category),
        eq(sharedMemory.key, key)
      )
    )
    .get();

  if (existing) {
    if (existing.value === value) return "unchanged";
    db.update(sharedMemory)
      .set({ value, updatedBy, updatedAt: new Date().toISOString() })
      .where(eq(sharedMemory.id, existing.id))
      .run();
    return "updated";
  }

  db.insert(sharedMemory)
    .values({ id: ulid(), tenantId, category, key, value, updatedBy })
    .run();
  return "created";
}

export function importBrand(): { created: number; updated: number; unchanged: number; errors: string[] } {
  const tenantId = getTenantId();
  const brandRepo = process.env.GAMEYE_BRAND_PATH ||
    path.join(process.env.HOME || "", "projects", "gameye-brand");

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const errors: string[] = [];

  // Import brand.md
  const brandFile = path.join(brandRepo, "brand.md");
  if (fs.existsSync(brandFile)) {
    const content = fs.readFileSync(brandFile, "utf-8");
    const sections = content.split(/^## /m).filter(Boolean);

    // Full brand doc
    const r = upsertMemory(tenantId, "brand_voice", "primary", content);
    if (r === "created") created++; else if (r === "updated") updated++; else unchanged++;

    // Extract sections
    const sectionMap: Record<string, [string, string]> = {
      "One-line description": ["brand_voice", "one_liner"],
      "Value proposition": ["brand_voice", "value_proposition"],
      "Key facts": ["brand_voice", "proof_points"],
      "Infrastructure": ["technical_docs", "infrastructure"],
      "Pricing": ["brand_voice", "pricing"],
      "Target customer": ["icp", "primary"],
      "Key assumptions": ["technical_docs", "assumptions"],
      "Pain points": ["icp", "pain_points"],
      "Competitive positioning": ["competitors", "primary"],
      "Social proof": ["brand_voice", "social_proof"],
      "Logo": ["brand_voice", "brand_assets"],
      "Tone of voice": ["brand_voice", "tone_of_voice"],
    };

    for (const section of sections) {
      const firstLine = section.split("\n")[0].trim();
      for (const [match, [cat, key]] of Object.entries(sectionMap)) {
        if (firstLine.includes(match)) {
          const r = upsertMemory(tenantId, cat, key, `## ${section}`);
          if (r === "created") created++; else if (r === "updated") updated++; else unchanged++;
          break;
        }
      }
    }
  } else {
    errors.push(`Brand file not found at ${brandFile}`);
  }

  // Import ai-search-strategy.md
  const aiSearchFile = path.join(brandRepo, "ai-search-strategy.md");
  if (fs.existsSync(aiSearchFile)) {
    const content = fs.readFileSync(aiSearchFile, "utf-8");
    const r = upsertMemory(tenantId, "competitors", "ai_search_strategy", content);
    if (r === "created") created++; else if (r === "updated") updated++; else unchanged++;
  }

  // Import knowledge files
  const knowledgeDir = path.join(brandRepo, "knowledge");
  if (fs.existsSync(knowledgeDir)) {
    const categoryMap: Record<string, string> = {
      brand: "brand_voice",
      company: "brand_voice",
      competitive: "competitors",
      product: "technical_docs",
      sales: "icp",
      technical: "technical_docs",
    };

    const categories = fs.readdirSync(knowledgeDir);
    for (const category of categories) {
      const catDir = path.join(knowledgeDir, category);
      if (!fs.statSync(catDir).isDirectory()) continue;

      const files = fs.readdirSync(catDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(catDir, file), "utf-8");
        const key = file.replace(/\.md$/, "");
        const memoryCategory = categoryMap[category] || "custom";
        const r = upsertMemory(tenantId, memoryCategory, `knowledge_${category}_${key}`, content);
        if (r === "created") created++; else if (r === "updated") updated++; else unchanged++;
      }
    }
  }

  return { created, updated, unchanged, errors };
}
