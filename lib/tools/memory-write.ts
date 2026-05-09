import { db } from "@/db";
import { sharedMemory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { RegisteredTool } from "./types";

const VALID_CATEGORIES = [
  "icp",
  "brand_voice",
  "tools",
  "connectors",
  "competitors",
  "deals",
  "strategy",
  "contacts",
  "custom",
] as const;

export const memoryWrite: RegisteredTool = {
  definition: {
    name: "write_shared_memory",
    description: `Store a fact in shared cross-agent memory so every desk (Scout, Steward, Outreach, CoS, etc.) can read it.
Use this when you learn something durable about the business — a contact detail, competitor insight, deal status, ICP signal, or strategy decision.
Do NOT store ephemeral conversation context; store facts that will still matter tomorrow.

Categories:
- icp: Ideal customer profile, target segments, qualification criteria
- brand_voice: Messaging, tone, positioning
- competitors: Competitor info, pricing, weaknesses
- deals: Deal-specific facts (use deal name as key prefix)
- contacts: Person or company facts worth sharing
- strategy: Decisions, priorities, playbooks
- custom: Anything else`,
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Unique identifier for this fact (e.g. 'gameye-icp-primary', 'deal-nexon-stage', 'competitor-multiplay-pricing'). Use snake_case.",
        },
        value: {
          type: "string",
          description: "The fact to store — be specific and complete. Markdown is fine.",
        },
        category: {
          type: "string",
          enum: VALID_CATEGORIES,
          description: "Category for filtering and namespacing.",
        },
        confidence: {
          type: "number",
          description: "How confident you are this is accurate (0-1, default 0.8). Use lower values for inferences.",
        },
      },
      required: ["key", "value", "category"],
    },
  },
  scopes: ["all"],
  async execute(input, tenantId) {
    const key = String(input.key ?? "").trim();
    const value = String(input.value ?? "").trim();
    const category = String(input.category ?? "custom");
    const confidence = typeof input.confidence === "number"
      ? Math.min(1, Math.max(0, input.confidence))
      : 0.8;

    if (!key || !value) return "write_shared_memory: key and value are required.";
    if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
      return `write_shared_memory: invalid category "${category}". Valid: ${VALID_CATEGORIES.join(", ")}`;
    }

    // Check if an existing entry exists to decide insert vs update
    const existing = db
      .select({ id: sharedMemory.id })
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

    const now = new Date().toISOString();

    if (existing) {
      db.update(sharedMemory)
        .set({ value, confidence, updatedAt: now })
        .where(eq(sharedMemory.id, existing.id))
        .run();
      return `Shared memory updated: [${category}] ${key}`;
    }

    db.insert(sharedMemory).values({
      id: ulid(),
      tenantId,
      layer: "global",
      scopeRefId: "",
      category,
      key,
      value,
      confidence,
      createdAt: now,
      updatedAt: now,
    }).run();

    return `Shared memory stored: [${category}] ${key}`;
  },
};
