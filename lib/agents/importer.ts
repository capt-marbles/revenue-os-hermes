import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { ulid } from "ulid";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { getAgentSources } from "./sources";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface ParsedAgent {
  name: string;
  slug: string;
  description: string;
  source: "marketing-skills" | "agency-agents" | "custom";
  sourceRef: string;
  systemPrompt: string;
  model: string;
  capabilities: string[];
  tools: string[];
  config: Record<string, unknown>;
}

function parseSkillFile(filePath: string, source: "marketing-skills" | "agency-agents"): ParsedAgent | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { data: frontmatter, content: body } = matter(content);

    const name = frontmatter.name || frontmatter.title ||
      path.basename(path.dirname(filePath));
    const description = frontmatter.description || "";
    const model = frontmatter.model || "sonnet";

    // Extract capabilities from frontmatter
    const capabilities: string[] = [];
    if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
      capabilities.push(...frontmatter.tags);
    }
    if (frontmatter.trigger) {
      capabilities.push(frontmatter.trigger);
    }
    // Agency-agents use 'tools' as a comma-separated string or array
    const tools: string[] = [];
    if (frontmatter.tools) {
      if (Array.isArray(frontmatter.tools)) {
        tools.push(...frontmatter.tools);
      } else if (typeof frontmatter.tools === "string") {
        tools.push(...frontmatter.tools.split(",").map((t: string) => t.trim()));
      }
    }

    // Store extra metadata (color, emoji, vibe) in config
    const config: Record<string, unknown> = {};
    if (frontmatter.color) config.color = frontmatter.color;
    if (frontmatter.emoji) config.emoji = frontmatter.emoji;
    if (frontmatter.vibe) config.vibe = frontmatter.vibe;

    // Derive category from directory name for agency-agents
    if (source === "agency-agents") {
      const dirName = path.basename(path.dirname(filePath));
      if (dirName) capabilities.push(dirName);
    }

    return {
      name,
      slug: slugify(name),
      description,
      source,
      sourceRef: filePath,
      systemPrompt: content,
      model,
      capabilities,
      tools,
      config,
    };
  } catch (err) {
    console.error(`Failed to parse ${filePath}:`, err);
    return null;
  }
}

export async function importAgents(): Promise<{ imported: number; updated: number; errors: number }> {
  const tenantId = getTenantId();
  const sources = getAgentSources();
  let imported = 0;
  let updated = 0;
  let errors = 0;

  for (const sourceConfig of sources) {
    for (const filePath of sourceConfig.paths) {
      const parsed = parseSkillFile(filePath, sourceConfig.source);
      if (!parsed) {
        errors++;
        continue;
      }

      // Check if agent already exists by tenant + slug
      const existing = db
        .select()
        .from(agents)
        .where(and(eq(agents.tenantId, tenantId), eq(agents.slug, parsed.slug)))
        .get();

      if (existing) {
        // Update existing agent
        db.update(agents)
          .set({
            name: parsed.name,
            description: parsed.description,
            agentType: "specialist",
            systemPrompt: parsed.systemPrompt,
            model: parsed.model,
            capabilities: JSON.stringify(parsed.capabilities),
            tools: JSON.stringify(parsed.tools),
            config: JSON.stringify(parsed.config),
            sourceRef: parsed.sourceRef,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(agents.id, existing.id))
          .run();
        updated++;
      } else {
        // Insert new agent
        db.insert(agents)
          .values({
            id: ulid(),
            tenantId,
            name: parsed.name,
            slug: parsed.slug,
            agentType: "specialist",
            source: parsed.source,
            sourceRef: parsed.sourceRef,
            description: parsed.description,
            capabilities: JSON.stringify(parsed.capabilities),
            tools: JSON.stringify(parsed.tools),
            config: JSON.stringify(parsed.config),
            systemPrompt: parsed.systemPrompt,
            model: parsed.model,
          })
          .run();
        imported++;
      }
    }
  }

  return { imported, updated, errors };
}
