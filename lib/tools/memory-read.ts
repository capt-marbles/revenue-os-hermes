import { db } from "@/db";
import { sharedMemory } from "@/db/schema";
import { and, desc, eq, like, or } from "drizzle-orm";
import type { RegisteredTool } from "./types";

export const memoryRead: RegisteredTool = {
  definition: {
    name: "read_shared_memory",
    description: `Read facts from shared cross-agent memory — the single source of truth built up by all desks.
Use this to recall what other agents have discovered without having to dispatch them.

Query options (all optional — omit all to get a broad recent snapshot):
- key: Exact key lookup (e.g. 'gameye-icp-primary')
- category: Filter by category (icp | brand_voice | competitors | deals | contacts | strategy | custom)
- search: Keyword to match against keys or values (partial match)

Returns up to 20 matching entries ordered by most recently updated.`,
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Exact key to look up.",
        },
        category: {
          type: "string",
          description: "Filter to a specific category.",
        },
        search: {
          type: "string",
          description: "Keyword to search across keys and values.",
        },
      },
      required: [],
    },
  },
  scopes: ["all"],
  async execute(input, tenantId) {
    const key = input.key ? String(input.key).trim() : undefined;
    const category = input.category ? String(input.category).trim() : undefined;
    const search = input.search ? String(input.search).trim() : undefined;

    const conditions = [
      eq(sharedMemory.tenantId, tenantId),
      eq(sharedMemory.layer, "global"),
    ];

    if (category) conditions.push(eq(sharedMemory.category, category));
    if (key) conditions.push(eq(sharedMemory.key, key));
    if (search) {
      conditions.push(
        or(
          like(sharedMemory.key, `%${search}%`),
          like(sharedMemory.value, `%${search}%`),
        )!,
      );
    }

    const rows = db
      .select()
      .from(sharedMemory)
      .where(and(...conditions))
      .orderBy(desc(sharedMemory.updatedAt))
      .limit(20)
      .all();

    if (rows.length === 0) {
      return "No shared memory entries found matching your query.";
    }

    const lines = rows.map((r) => {
      const age = formatAge(r.updatedAt);
      const conf = r.confidence != null && r.confidence < 1 ? ` (confidence: ${Math.round(r.confidence * 100)}%)` : "";
      const author = r.updatedBy ? ` — written by ${r.updatedBy}` : "";
      return `### [${r.category}] ${r.key}${conf}${author} · ${age}\n${r.value}`;
    });

    return `## Shared Memory (${rows.length} entries)\n\n${lines.join("\n\n---\n\n")}`;
  },
};

function formatAge(iso: string | null): string {
  if (!iso) return "unknown time";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
