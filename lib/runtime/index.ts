import type { AgentRuntime } from "./types";
import { ClaudeRuntime } from "./claude";
import { OpenClawRuntime } from "./openclaw";
import { CodexRuntime } from "./codex";
import { DirectApiRuntime } from "./direct-api";
import { AntbaseRuntime } from "./antbase";

// Registry of available runtimes
const runtimes: Record<string, AgentRuntime> = {
  claude: new ClaudeRuntime(),
  openclaw: new OpenClawRuntime(),
  codex: new CodexRuntime(),
  "direct-api": new DirectApiRuntime(),
  antbase: new AntbaseRuntime(),
};

// Default runtime — configurable via env var
const DEFAULT_RUNTIME = process.env.AGENT_RUNTIME || "claude";

/**
 * Get the default runtime.
 */
export function getRuntime(): AgentRuntime {
  return runtimes[DEFAULT_RUNTIME] || runtimes.claude;
}

/**
 * Get a specific runtime by ID.
 */
export function getRuntimeById(id: string): AgentRuntime | null {
  return runtimes[id] || null;
}

/**
 * List all available runtimes.
 */
export function listRuntimes(): { id: string; name: string }[] {
  return Object.values(runtimes).map((r) => ({ id: r.id, name: r.name }));
}

export { getOpenClawAgentForDesk, buildSessionKey, streamOpenClawChat } from "./openclaw";
export type { AgentRuntime, RuntimeConfig, RuntimeResult, StreamCallbacks } from "./types";
