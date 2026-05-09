import { db } from "@/db";
import { agents, policies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { queueAgentRun } from "@/lib/orchestration/run-agent";

interface DispatchContext {
  tenantId: string;
  input: string;
  triggerSource: string;
  triggerId?: string;
}

interface SpecialistSeed {
  slug: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  capabilities?: string[];
  tools?: string[];
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function ensureSpecialist(tenantId: string, specialist: SpecialistSeed) {
  const existing = db
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.slug, specialist.slug)))
    .get();

  if (existing) return existing;

  const created = {
    id: ulid(),
    tenantId,
    name: specialist.name,
    slug: specialist.slug,
    agentType: "specialist" as const,
    source: "custom" as const,
    sourceRef: null,
    description: specialist.description || "",
    capabilities: JSON.stringify(specialist.capabilities || []),
    systemPrompt: specialist.systemPrompt || "",
    model: specialist.model || "sonnet",
    tools: JSON.stringify(specialist.tools || []),
    status: "idle",
    config: JSON.stringify({ spawnedByPolicy: true }),
  };

  db.insert(agents).values(created).run();
  return created;
}

export function executePolicyTarget(policyId: string, context: DispatchContext) {
  const policy = db
    .select()
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.tenantId, context.tenantId)))
    .get();

  if (!policy || policy.enabled !== 1) {
    return { accepted: false, reason: "policy_not_available", runId: "" };
  }

  const actions = parseJson<Record<string, unknown>>(policy.actions, {});

  let targetAgentId =
    typeof actions.delegateToAgentId === "string" ? actions.delegateToAgentId : policy.targetAgentId;

  if (!targetAgentId && typeof actions.delegateToAgentSlug === "string") {
    const existing = db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.tenantId, context.tenantId),
          eq(agents.slug, actions.delegateToAgentSlug),
        ),
      )
      .get();
    targetAgentId = existing?.id || null;
  }

  if (!targetAgentId && actions.spawnSpecialist && typeof actions.spawnSpecialist === "object") {
    const specialist = ensureSpecialist(context.tenantId, actions.spawnSpecialist as SpecialistSeed);
    targetAgentId = specialist.id;
  }

  if (!targetAgentId) {
    return { accepted: false, reason: "policy_has_no_target", runId: "" };
  }

  const prefix = typeof actions.inputPrefix === "string" ? `${actions.inputPrefix}\n\n` : "";
  return queueAgentRun({
    tenantId: context.tenantId,
    agentId: targetAgentId,
    input: `${prefix}${context.input}`.trim(),
    trigger: "policy",
    metadata: {
      policyId: policy.id,
      policyName: policy.name,
      triggerId: context.triggerId,
      triggerSource: context.triggerSource,
    },
  });
}
