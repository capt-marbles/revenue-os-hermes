import { db } from "@/db";
import { connectors } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { RegisteredTool, ToolScope } from "./types";

export interface ToolSet {
  /** Anthropic-format tool definitions to pass in the API request. */
  definitions: RegisteredTool["definition"][];
  /** Execute a tool call by name, returning the result string. */
  execute: (name: string, input: Record<string, unknown>) => Promise<string>;
}

/**
 * Filter `tools` to those available for `scope` and whose required connector
 * (if any) is currently connected for `tenantId`.
 *
 * Pass `ALL_TOOLS` from `lib/tools/index.ts` as the first argument.
 */
export function getToolsForAgent(
  tools: RegisteredTool[],
  scope: ToolScope,
  tenantId: string,
): ToolSet {
  const connectedNames = new Set(
    db
      .select({ name: connectors.name })
      .from(connectors)
      .where(and(eq(connectors.tenantId, tenantId), eq(connectors.status, "connected")))
      .all()
      .map((c) => c.name.toLowerCase()),
  );

  const available = tools.filter((t) => {
    if (!t.scopes.includes(scope) && !t.scopes.includes("all")) return false;
    if (t.connector && !connectedNames.has(t.connector.toLowerCase())) return false;
    return true;
  });

  return {
    definitions: available.map((t) => t.definition),
    async execute(name, input) {
      const tool = available.find((t) => t.definition.name === name);
      if (!tool) return `Unknown tool: ${name}`;
      try {
        return await tool.execute(input, tenantId);
      } catch (err) {
        return `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
