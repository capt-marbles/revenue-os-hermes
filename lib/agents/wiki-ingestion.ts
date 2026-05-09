import { db } from "@/db";
import { directorWiki, deskAgents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ulid } from "ulid";
import { getRuntime, getRuntimeById } from "@/lib/runtime";

interface IngestParams {
  tenantId: string;
  runId: string;
  agentId: string;
  documentContent: string;
}

interface WikiOperation {
  action: "create" | "update";
  slug: string;
  title: string;
  category: string;
  content: string;
  tags?: string[];
}

/**
 * Post-run wiki ingestion.
 *
 * After an agent run produces a Document, this function:
 * 1. Determines which desk the agent belongs to
 * 2. Loads existing wiki entry titles for that desk
 * 3. Calls a cheap model to extract knowledge
 * 4. Creates or updates wiki entries
 *
 * Runs fire-and-forget — never blocks the main agent run.
 */
export async function ingestToWiki(params: IngestParams): Promise<void> {
  const { tenantId, runId, agentId, documentContent } = params;

  // Skip very short documents — not enough content to extract from
  if (documentContent.length < 100) return;

  // Find the desk for this agent
  const assignment = db
    .select()
    .from(deskAgents)
    .where(eq(deskAgents.agentId, agentId))
    .get();

  if (!assignment) return; // Agent not assigned to any desk

  const deskId = assignment.deskId;

  // Load existing wiki entries (titles + slugs only) for this desk
  const existingEntries = db
    .select({
      slug: directorWiki.slug,
      title: directorWiki.title,
      category: directorWiki.category,
    })
    .from(directorWiki)
    .where(and(eq(directorWiki.tenantId, tenantId), eq(directorWiki.deskId, deskId)))
    .all();

  const existingList = existingEntries.length > 0
    ? existingEntries.map((e) => `- ${e.title} [${e.category}] (slug: ${e.slug})`).join("\n")
    : "(no existing entries)";

  // Build the extraction prompt
  const prompt = `You are a knowledge curator. Extract key facts, insights, or data points from the following document and output structured wiki operations.

## Existing Wiki Entries for This Desk
${existingList}

## Document to Process
${documentContent.slice(0, 6000)}

## Instructions
Extract reusable knowledge from this document. For each piece of knowledge, either:
- UPDATE an existing entry if the document adds to or modifies it (use the existing slug)
- CREATE a new entry if this is genuinely new knowledge

Categories: competitor, icp_segment, tactic, insight, process, reference

Output ONLY a JSON array. No markdown, no explanation:
[
  {"action": "create", "slug": "example-slug", "title": "Example Title", "category": "insight", "content": "The actual knowledge...", "tags": ["tag1", "tag2"]},
  {"action": "update", "slug": "existing-slug", "title": "Updated Title", "category": "competitor", "content": "Merged content..."}
]

If there is nothing worth extracting, output an empty array: []`;

  // Use haiku for cost efficiency — this is a structured extraction task
  const runtime = getRuntimeById("claude") || getRuntime();
  const result = await runtime.execute(prompt, {
    model: "haiku",
    maxTurns: 2,
    timeout: 60000,
  });

  if (result.exitCode !== 0) {
    console.error(`[Wiki Ingestion] Failed for run ${runId}:`, result.stderr.slice(0, 200));
    return;
  }

  // Parse the response — extract JSON from the output
  let operations: WikiOperation[] = [];
  try {
    // Handle Claude's JSON output wrapper
    let rawOutput = result.stdout;
    try {
      const envelope = JSON.parse(rawOutput);
      rawOutput = envelope.result || rawOutput;
    } catch {
      // Not wrapped — use as-is
    }

    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      operations = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error(`[Wiki Ingestion] Failed to parse response for run ${runId}:`, err);
    return;
  }

  if (operations.length === 0) return;

  // Execute operations
  let created = 0;
  let updated = 0;

  for (const op of operations) {
    if (!op.slug || !op.title || !op.content || !op.category) continue;

    const validCategories = ["competitor", "icp_segment", "tactic", "insight", "process", "reference"];
    if (!validCategories.includes(op.category)) continue;

    if (op.action === "update") {
      const existing = db
        .select()
        .from(directorWiki)
        .where(and(
          eq(directorWiki.tenantId, tenantId),
          eq(directorWiki.deskId, deskId),
          eq(directorWiki.slug, op.slug),
        ))
        .get();

      if (existing) {
        // Merge sourceRunIds
        let sourceIds: string[] = [];
        try { sourceIds = JSON.parse(existing.sourceRunIds || "[]"); } catch {}
        if (!sourceIds.includes(runId)) sourceIds.push(runId);

        db.update(directorWiki)
          .set({
            title: op.title,
            content: op.content,
            category: op.category,
            tags: JSON.stringify(op.tags || []),
            sourceRunIds: JSON.stringify(sourceIds),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(directorWiki.id, existing.id))
          .run();
        updated++;
      }
    } else {
      // Create new entry
      db.insert(directorWiki)
        .values({
          id: ulid(),
          tenantId,
          deskId,
          slug: op.slug,
          title: op.title,
          category: op.category,
          content: op.content,
          tags: JSON.stringify(op.tags || []),
          sourceRunIds: JSON.stringify([runId]),
          confidence: "medium",
        })
        .run();
      created++;
    }
  }

  if (created > 0 || updated > 0) {
    console.log(JSON.stringify({
      event: "wiki_ingestion_complete",
      runId,
      deskId,
      created,
      updated,
      timestamp: new Date().toISOString(),
    }));
  }
}
