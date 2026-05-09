import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { sharedMemory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";

const anthropic = new Anthropic();

interface MemoryCandidate {
  key: string;
  value: string;
  category: string;
  confidence: number;
}

const CLASSIFIER_PROMPT = `You are a memory classifier for a B2B SaaS revenue operations system.

Given a conversation turn (user message + agent response), extract any durable facts worth storing in shared memory. Only store things that:
- Are factual claims about customers, prospects, competitors, deals, strategy, or the business
- Will still be relevant tomorrow or next week
- Are specific enough to be actionable

Do NOT store:
- Ephemeral conversation filler ("sounds good", "let me check")
- Instructions or commands the user gave the agent
- Formatting or structural content

Valid categories: icp, brand_voice, competitors, deals, contacts, strategy, custom

Respond with a JSON array (empty if nothing is worth storing):
[
  {
    "key": "snake_case_unique_key",
    "value": "The full fact, written clearly and standalone",
    "category": "one of the valid categories",
    "confidence": 0.0–1.0
  }
]

Respond with ONLY the JSON array — no explanation, no markdown fences.`;

export async function classifyAndStoreMemory(
  tenantId: string,
  deskSlug: string,
  userMessage: string,
  agentResponse: string,
): Promise<void> {
  // Skip very short responses — nothing durable to extract
  if (agentResponse.length < 100) return;

  const turnText = `USER: ${userMessage}\n\nAGENT (${deskSlug}): ${agentResponse.slice(0, 3000)}`;

  let candidates: MemoryCandidate[] = [];
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: CLASSIFIER_PROMPT,
      messages: [{ role: "user", content: turnText }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    candidates = JSON.parse(text);
    if (!Array.isArray(candidates)) return;
  } catch {
    // Classifier failure is non-critical — silent skip
    return;
  }

  const now = new Date().toISOString();

  for (const c of candidates) {
    if (!c.key || !c.value || !c.category) continue;

    const key = String(c.key).trim().slice(0, 120);
    const value = String(c.value).trim();
    const category = String(c.category).trim();
    const confidence = typeof c.confidence === "number"
      ? Math.min(1, Math.max(0, c.confidence))
      : 0.7;

    const existing = db
      .select({ id: sharedMemory.id, confidence: sharedMemory.confidence })
      .from(sharedMemory)
      .where(
        and(
          eq(sharedMemory.tenantId, tenantId),
          eq(sharedMemory.layer, "global"),
          eq(sharedMemory.scopeRefId, ""),
          eq(sharedMemory.category, category),
          eq(sharedMemory.key, key),
        ),
      )
      .get();

    if (existing) {
      // Only overwrite if new confidence is higher
      if (confidence >= (existing.confidence ?? 0)) {
        db.update(sharedMemory)
          .set({ value, confidence, updatedBy: deskSlug, updatedAt: now })
          .where(eq(sharedMemory.id, existing.id))
          .run();
      }
    } else {
      db.insert(sharedMemory).values({
        id: ulid(),
        tenantId,
        layer: "global",
        scopeRefId: "",
        category,
        key,
        value,
        updatedBy: deskSlug,
        confidence,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  }
}
