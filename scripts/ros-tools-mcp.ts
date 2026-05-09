#!/usr/bin/env tsx
/**
 * ROS Tools MCP Server
 *
 * Exposes Revenue OS's tool registry over the Model Context Protocol (MCP)
 * stdio transport so the local Claude Code CLI can invoke them as agentic
 * tools while still using the user's Max subscription for inference.
 *
 * Spawned as a child process of `claude` via `--mcp-config`. Tools are
 * filtered by `ROS_SCOPE` (a ToolScope value) and executed against the
 * caller's `ROS_TENANT_ID`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ALL_TOOLS, getToolsForAgent } from "@/lib/tools";
import type { ToolScope } from "@/lib/tools/types";

const scope = (process.env.ROS_SCOPE || "all") as ToolScope;
const tenantId = process.env.ROS_TENANT_ID || "";

if (!tenantId) {
  console.error("[ros-tools-mcp] ROS_TENANT_ID not set");
  process.exit(2);
}

const toolSet = getToolsForAgent(ALL_TOOLS, scope, tenantId);

const server = new Server(
  { name: "ros-tools", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolSet.definitions.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: d.input_schema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const text = await toolSet.execute(name, args);
  return { content: [{ type: "text", text }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Keep the process alive on stdin EOF — MCP clients close stdin to signal
// shutdown, but ours is driven by transport lifecycle.
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
