import { db } from "@/db";
import { directorWiki, deskAgents } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

interface WikiQueryParams {
  tenantId: string;
  deskId: string;
  keywords?: string[];
  categories?: string[];
  limit?: number;
}

interface WikiEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  confidence: string | null;
}

/**
 * Query wiki entries relevant to a given context.
 * Uses keyword matching against title, tags, and content.
 * Updates lastReferencedAt for returned entries.
 */
export function queryWiki(params: WikiQueryParams): WikiEntry[] {
  const { tenantId, deskId, keywords = [], categories = [], limit = 5 } = params;

  let entries = db
    .select()
    .from(directorWiki)
    .where(and(eq(directorWiki.tenantId, tenantId), eq(directorWiki.deskId, deskId)))
    .orderBy(desc(directorWiki.updatedAt))
    .all();

  // Filter by category if specified
  if (categories.length > 0) {
    entries = entries.filter((e) => categories.includes(e.category));
  }

  // Score entries by keyword relevance
  if (keywords.length > 0) {
    const scored = entries.map((entry) => {
      let score = 0;
      const titleLower = entry.title.toLowerCase();
      const contentLower = entry.content.toLowerCase();
      const tagsLower = (entry.tags || "[]").toLowerCase();

      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        if (titleLower.includes(kwLower)) score += 3; // Title match is highest signal
        if (tagsLower.includes(kwLower)) score += 2;
        if (contentLower.includes(kwLower)) score += 1;
      }

      // Boost high confidence entries
      if (entry.confidence === "high") score += 1;

      return { entry, score };
    });

    // Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);
    entries = scored
      .filter((s) => s.score > 0)
      .slice(0, limit)
      .map((s) => s.entry);
  } else {
    // No keywords — return most recent entries
    entries = entries.slice(0, limit);
  }

  // Update lastReferencedAt for returned entries
  const now = new Date().toISOString();
  for (const entry of entries) {
    db.update(directorWiki)
      .set({ lastReferencedAt: now })
      .where(eq(directorWiki.id, entry.id))
      .run();
  }

  return entries.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    content: e.content,
    confidence: e.confidence,
  }));
}

/**
 * Get the deskId for a given agent (via desk_agents junction).
 * Returns the first desk found, or null.
 */
export function getDeskForAgent(agentId: string): string | null {
  const assignment = db
    .select()
    .from(deskAgents)
    .where(eq(deskAgents.agentId, agentId))
    .get();

  return assignment?.deskId ?? null;
}

/**
 * Extract keywords from a text string for wiki querying.
 * Simple approach: split on spaces, filter stopwords, take top N by length.
 */
export function extractKeywords(text: string, maxKeywords: number = 8): string[] {
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "this", "that",
    "these", "those", "it", "its", "my", "your", "his", "her", "our",
    "their", "what", "which", "who", "whom", "how", "when", "where",
    "why", "not", "no", "all", "each", "every", "some", "any", "few",
    "more", "most", "other", "into", "than", "then", "just", "about",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));

  // Deduplicate and take longest words (more specific)
  const unique = [...new Set(words)];
  unique.sort((a, b) => b.length - a.length);

  return unique.slice(0, maxKeywords);
}

/**
 * Format wiki entries as a markdown section for prompt injection.
 */
export function formatWikiForPrompt(entries: WikiEntry[]): string {
  if (entries.length === 0) return "";

  const sections = entries.map((e) => {
    const confidence = e.confidence === "high" ? "" : ` [${e.confidence} confidence]`;
    return `### ${e.title}${confidence}\n${e.content}`;
  });

  return `## Director Knowledge Base\n\n${sections.join("\n\n---\n\n")}`;
}
