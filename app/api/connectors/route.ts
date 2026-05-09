import { db } from "@/db";
import { connectors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { CONNECTOR_DEFINITIONS, isConnectorConfigured } from "@/lib/connectors/mcp-config";

export async function GET() {
  const tenantId = getTenantId();

  // Get stored connector states
  const stored = db
    .select()
    .from(connectors)
    .where(eq(connectors.tenantId, tenantId))
    .all();

  const storedMap = new Map(stored.map((c) => [c.name, c]));

  // Merge definitions with stored state
  const result = CONNECTOR_DEFINITIONS.map((def) => {
    const existing = storedMap.get(def.id);
    return {
      id: existing?.id ?? null,
      definitionId: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      icon: def.icon,
      status: existing?.status ?? "disconnected",
      configured: isConnectorConfigured(def.id),
      requiredEnv: def.requiredEnv,
    };
  });

  return Response.json(result);
}
