import { db } from "@/db";
import { connectors } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { RegisteredTool } from "./types";

export const getToolConnections: RegisteredTool = {
  definition: {
    name: "get_tool_connections",
    description:
      "Check which external tools (Apollo, Hunter, LinkedIn, Steam-Bridge, etc.) are connected, disconnected, or erroring, and when they last synced.",
    input_schema: { type: "object", properties: {} },
  },
  scopes: ["cos"],
  async execute(_input, tenantId) {
    const rows = db
      .select()
      .from(connectors)
      .where(eq(connectors.tenantId, tenantId))
      .all();

    if (rows.length === 0) return "No connectors configured.";

    const lines = [
      "## Tool Connection Status\n",
      "| Tool | Status | Last Synced |",
      "|------|--------|-------------|",
      ...rows.map((c) => {
        const lastSync = c.lastSyncedAt
          ? new Date(c.lastSyncedAt).toLocaleDateString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            })
          : "never";
        const icon = c.status === "connected" ? "✅" : c.status === "error" ? "❌" : "⚠️";
        return `| ${c.name} | ${icon} ${c.status} | ${lastSync} |`;
      }),
    ];

    const connected = rows.filter((c) => c.status === "connected").length;
    lines.push(`\n${connected}/${rows.length} tools connected.`);
    return lines.join("\n");
  },
};
