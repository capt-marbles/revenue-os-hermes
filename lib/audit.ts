import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";

interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  summary: string;
  source?: string;
  deskId?: string | null;
  metadata?: Record<string, unknown>;
}

export function logAudit(entry: AuditEntry): void {
  const tenantId = getTenantId();

  db.insert(auditLog)
    .values({
      id: ulid(),
      tenantId,
      deskId: entry.deskId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      summary: entry.summary,
      source: entry.source || "operator",
      metadata: JSON.stringify(entry.metadata || {}),
    })
    .run();
}
