import fs from "fs";
import path from "path";

/**
 * Shared approval store for Revenue OS.
 *
 * File-backed store for approval requests from Hermes agents.
 * Keeps local approvals stable across restarts without introducing a migration.
 */

export interface ApprovalRequest {
  id: string;
  deskId: string;
  sessionKey: string;
  command: string;
  description: string;
  patternKey: string;
  patternKeys: string[];
  status: "pending" | "approved" | "denied";
  choice?: "once" | "session" | "always" | "deny";
  createdAt: string;
  resolvedAt?: string;
}

let idCounter = 0;
function nextId(): string {
  return `apr_${Date.now()}_${++idCounter}`;
}

const APPROVAL_STORE_FILE =
  process.env.APPROVAL_STORE_FILE || path.join(process.cwd(), "data", "approvals.json");

function loadStore(): Map<string, ApprovalRequest> {
  try {
    const raw = fs.readFileSync(APPROVAL_STORE_FILE, "utf-8");
    const approvals = JSON.parse(raw) as ApprovalRequest[];
    const map = new Map<string, ApprovalRequest>();

    for (const approval of approvals) {
      if (approval?.id) {
        map.set(approval.id, approval);
      }
    }

    return map;
  } catch {
    return new Map<string, ApprovalRequest>();
  }
}

function persistStore() {
  fs.mkdirSync(path.dirname(APPROVAL_STORE_FILE), { recursive: true });
  fs.writeFileSync(
    APPROVAL_STORE_FILE,
    JSON.stringify(Array.from(store.values()), null, 2),
    "utf-8",
  );
}

// Singleton store
const store = loadStore();

export function getApprovalStore(): Map<string, ApprovalRequest> {
  return store;
}

export function createApproval(data: {
  deskId: string;
  sessionKey: string;
  command: string;
  description: string;
  patternKey?: string;
  patternKeys?: string[];
}): ApprovalRequest {
  const approval: ApprovalRequest = {
    id: nextId(),
    deskId: data.deskId,
    sessionKey: data.sessionKey,
    command: data.command,
    description: data.description,
    patternKey: data.patternKey || data.description,
    patternKeys: data.patternKeys || [data.patternKey || data.description],
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  store.set(approval.id, approval);
  persistStore();
  return approval;
}

export function getPendingApprovals(deskId?: string): ApprovalRequest[] {
  let approvals = Array.from(store.values()).filter((a) => a.status === "pending");

  if (deskId) {
    approvals = approvals.filter((a) => a.deskId === deskId);
  }

  return approvals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveApproval(
  id: string,
  choice: "once" | "session" | "always" | "deny",
): ApprovalRequest | null {
  const approval = store.get(id);
  if (!approval || approval.status !== "pending") return null;

  approval.status = choice === "deny" ? "denied" : "approved";
  approval.choice = choice;
  approval.resolvedAt = new Date().toISOString();
  persistStore();
  return approval;
}

export function revertApproval(id: string): ApprovalRequest | null {
  const approval = store.get(id);
  if (!approval || approval.status === "pending") return null;

  approval.status = "pending";
  delete approval.choice;
  delete approval.resolvedAt;
  persistStore();
  return approval;
}

// Helper: map desk slug to Hermes profile
export function getProfileForDesk(deskId: string): string {
  const map: Record<string, string> = {
    scout: "scout",
    outreach: "outreach",
    steward: "steward",
  };
  return map[deskId] || "default";
}

// Helper: resolve approval via Hermes gateway
export async function resolveViaHermes(
  sessionKey: string,
  choice: string,
  profile: string,
): Promise<boolean> {
  // Profile gateways run on different ports: default=8642, scout=8643, outreach=8644, steward=8645
  const profilePorts: Record<string, number> = {
    default: 8642,
    scout: 8643,
    outreach: 8644,
    steward: 8645,
    marketing: 8646,
    "sales-engineering": 8647,
    "chief-of-staff": 8648,
  };
  const port = profilePorts[profile] || 8642;
  const HERMES_WEBAPI_URL = process.env.HERMES_WEBAPI_URL || `http://localhost:${port}`;

  try {
    const approvalMsg =
      choice === "deny"
        ? "/deny"
        : `/approve${choice === "session" ? " session" : ""}${choice === "always" ? " always" : ""}`;

    const res = await fetch(`${HERMES_WEBAPI_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [{ role: "user", content: approvalMsg }],
        stream: false,
        profile,
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}
