import { db } from "@/db";
import { connectors } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import fs from "fs";
import os from "os";
import path from "path";

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Available connector definitions — what we know how to configure.
 */
export const CONNECTOR_DEFINITIONS = [
  {
    id: "maton-gmail",
    name: "Gmail (via Maton)",
    type: "mcp" as const,
    category: "google-workspace",
    description: "Send emails, manage drafts, read messages and threads",
    requiredEnv: "MATON_API_KEY",
    mcpPackage: "@maton/mcp",
    icon: "mail",
  },
  {
    id: "maton-calendar",
    name: "Google Calendar (via Maton)",
    type: "mcp" as const,
    category: "google-workspace",
    description: "Create events, check availability, manage calendars",
    requiredEnv: "MATON_API_KEY",
    mcpPackage: "@maton/mcp",
    icon: "calendar",
  },
  {
    id: "maton-drive",
    name: "Google Drive (via Maton)",
    type: "mcp" as const,
    category: "google-workspace",
    description: "Search, read, and manage files in Google Drive",
    requiredEnv: "MATON_API_KEY",
    mcpPackage: "@maton/mcp",
    icon: "hard-drive",
  },
  {
    id: "maton-sheets",
    name: "Google Sheets (via Maton)",
    type: "mcp" as const,
    category: "google-workspace",
    description: "Read and write spreadsheet data",
    requiredEnv: "MATON_API_KEY",
    mcpPackage: "@maton/mcp",
    icon: "table",
  },
  {
    id: "twenty-crm",
    name: "Twenty CRM",
    type: "api_key" as const,
    category: "crm",
    description: "Manage contacts, companies, and opportunities in Twenty",
    requiredEnv: "TWENTY_API_KEY",
    icon: "users",
    capabilities: ["contacts", "companies", "opportunities"],
  },
  {
    id: "apollo-prospecting",
    name: "Apollo.io",
    type: "api_key" as const,
    category: "prospecting",
    description: "Search, enrich, and export prospect data from Apollo",
    requiredEnv: "APOLLO_API_KEY",
    icon: "search",
    capabilities: ["people_search", "people_match", "company_search", "enrichment"],
  },
  {
    id: "hunter-email",
    name: "Hunter.io",
    type: "api_key" as const,
    category: "prospecting",
    description: "Find and verify professional email addresses by company domain",
    requiredEnv: "HUNTER_API_KEY",
    icon: "mail-check",
    capabilities: ["domain_search", "email_finder", "email_verifier"],
  },
] as const;

/**
 * Build an MCP config JSON for active connectors.
 * Returns the path to a temporary config file that can be passed to claude --mcp-config.
 */
export function buildMcpConfigFile(): string | null {
  const tenantId = getTenantId();
  const matonKey = process.env.MATON_API_KEY;

  // Get enabled connectors from DB
  const enabled = db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.status, "connected")))
    .all();

  if (enabled.length === 0) return null;

  const config: McpConfig = { mcpServers: {} };
  let hasMatonConnector = false;

  for (const conn of enabled) {
    const def = CONNECTOR_DEFINITIONS.find((d) => d.id === conn.name);
    if (!def) continue;

    if ("mcpPackage" in def && def.mcpPackage === "@maton/mcp" && matonKey) {
      hasMatonConnector = true;
    }
  }

  // Maton MCP — single server handles all Google Workspace tools
  if (hasMatonConnector && matonKey) {
    config.mcpServers["maton"] = {
      command: "npx",
      args: ["-y", "@maton/mcp"],
      env: {
        MATON_API_KEY: matonKey,
      },
    };
  }

  if (Object.keys(config.mcpServers).length === 0) return null;

  // Write to temp file with restricted permissions (0o600 = owner read/write only)
  const tmpDir = path.join(os.tmpdir(), "revenue-os");
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const configPath = path.join(tmpDir, `mcp-config-${tenantId}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

  return configPath;
}

/**
 * Check if a connector's required env var is set either in environment or secrets file.
 */
export function isConnectorConfigured(connectorId: string): boolean {
  const def = CONNECTOR_DEFINITIONS.find((d) => d.id === connectorId);
  if (!def) return false;

  if (def.requiredEnv) {
    // Check environment first
    if (!!process.env[def.requiredEnv]) return true;
    
    // Check if we have any cached value from API
    const cachedValue = (global as any).__secrets_cache?.[def.requiredEnv];
    return !!cachedValue;
  }
  return true;
}
