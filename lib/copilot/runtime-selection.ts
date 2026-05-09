import { getRuntime } from "@/lib/runtime";

const RUNTIME_IDS = new Set(["claude", "openclaw", "codex", "direct-api", "antbase"]);

export interface RuntimeSelection {
  runtimeId: string;
  model?: string;
}

export function getChiefOfStaffCodexSandboxMode():
  | "read-only"
  | "workspace-write"
  | "danger-full-access" {
  const raw = process.env.CHIEF_OF_STAFF_CODEX_SANDBOX?.trim();
  if (
    raw === "read-only" ||
    raw === "workspace-write" ||
    raw === "danger-full-access"
  ) {
    return raw;
  }

  return "read-only";
}

export function parseRuntimeModelOverride(model?: string): RuntimeSelection | null {
  if (!model) return null;

  const separator = model.indexOf(":");
  if (separator <= 0) return null;

  const runtimeId = model.slice(0, separator).trim();
  if (!RUNTIME_IDS.has(runtimeId)) return null;

  const strippedModel = model.slice(separator + 1).trim() || undefined;
  return { runtimeId, model: strippedModel };
}

export function resolveChiefOfStaffRuntime(model?: string): RuntimeSelection {
  const override = parseRuntimeModelOverride(model);
  if (override) {
    return {
      runtimeId: override.runtimeId,
      model: normalizeChiefOfStaffModel(
        override.runtimeId,
        override.model ?? defaultChiefOfStaffModel(override.runtimeId),
      ),
    };
  }

  const configuredRuntime =
    process.env.CHIEF_OF_STAFF_RUNTIME?.trim() ||
    process.env.COPILOT_COS_RUNTIME?.trim();

  if (configuredRuntime) {
    return {
      runtimeId: configuredRuntime,
      model: normalizeChiefOfStaffModel(
        configuredRuntime,
        model ?? defaultChiefOfStaffModel(configuredRuntime),
      ),
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      runtimeId: "anthropic",
      model: model ?? "claude-sonnet-4-6",
    };
  }

  const fallback = getRuntime();
  return {
    runtimeId: fallback.id,
    model: normalizeChiefOfStaffModel(
      fallback.id,
      model ?? defaultChiefOfStaffModel(fallback.id),
    ),
  };
}

function defaultChiefOfStaffModel(runtimeId: string): string {
  switch (runtimeId) {
    case "codex":
      return process.env.CHIEF_OF_STAFF_CODEX_MODEL || "gpt-5.4";
    case "antbase":
      return "ant:balanced";
    case "direct-api":
      return process.env.DIRECT_API_MODEL || "gpt-5.4";
    case "anthropic":
      return "claude-sonnet-4-6";
    default:
      return "claude-sonnet-4-6";
  }
}

function normalizeChiefOfStaffModel(runtimeId: string, model: string): string {
  if (runtimeId === "codex") {
    if (isAnthropicModel(model) || isOpenRouterModel(model)) {
      return defaultChiefOfStaffModel("codex");
    }
  }

  return model;
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-") || model.startsWith("anthropic/");
}

function isOpenRouterModel(model: string): boolean {
  return model.includes("/");
}
