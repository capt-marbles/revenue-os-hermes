import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import type { AgentRuntime, RuntimeConfig, RuntimeResult, StreamCallbacks } from "./types";

/**
 * Map desk slug to OpenClaw agent ID.
 * These must match agent IDs in ~/.openclaw/openclaw.json → agents.list[].id
 */
const DESK_AGENT_MAP: Record<string, string> = {
  scout: "scout",
  outreach: "outreach",
  steward: "steward",
  marketing: "marketing",
  "sales-engineering": "sales-engineering",
  "chief-of-staff": "chief-of-staff",
};

export function getOpenClawAgentForDesk(deskSlug: string): string | null {
  // TODO: Re-enable once OpenClaw agent sessions are configured and tested
  // The CLI-based approach was too fragile for production use.
  // return DESK_AGENT_MAP[deskSlug] ?? null;
  return null;
}

export function buildSessionKey(agentId: string): string {
  return `agent:${agentId}:main`;
}

// ---------------------------------------------------------------------------
// Session file helpers
// ---------------------------------------------------------------------------

interface SessionEntry {
  sessionId: string;
}

function getSessionDir(agentId: string): string {
  return `${process.env.HOME}/.openclaw/agents/${agentId}/sessions`;
}

/**
 * Get the JSONL file path for the active session of a given agent.
 *
 * sessions.json is a Record<string, SessionEntry> keyed by session key
 * (e.g. "agent:marketing:main").
 */
function getActiveSessionFile(agentId: string): string | null {
  const dir = getSessionDir(agentId);
  const indexFile = `${dir}/sessions.json`;
  if (!existsSync(indexFile)) return null;

  try {
    const data: Record<string, SessionEntry> = JSON.parse(readFileSync(indexFile, "utf-8"));
    const key = `agent:${agentId}:main`;
    const entry = data[key];
    if (!entry?.sessionId) return null;
    return `${dir}/${entry.sessionId}.jsonl`;
  } catch {
    return null;
  }
}

/**
 * Read the last assistant text from a session JSONL file.
 *
 * Message entries have shape: { type: "message", message: { role, content, ... } }
 * where content is an array of { type: "text", text: string } blocks.
 */
function readLastAssistantText(sessionFile: string): string {
  if (!existsSync(sessionFile)) return "";

  try {
    const content = readFileSync(sessionFile, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.trim());
    let lastText = "";

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message") {
          const msg = entry.message;
          if (msg?.role === "assistant" && Array.isArray(msg.content)) {
            const text = msg.content
              .filter((c: { type?: string }) => c.type === "text")
              .map((c: { text?: string }) => c.text ?? "")
              .join("");
            if (text) lastText = text;
          }
        }
      } catch {
        // skip malformed lines
      }
    }
    return lastText;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * OpenClaw CLI runtime.
 *
 * Sends a message to an agent session via `openclaw chat --session ... --message ...`
 * and reads the new assistant response from the session's JSONL file.
 *
 * This avoids parsing TUI output entirely — we snapshot the last assistant
 * text before sending, then diff after the CLI exits.
 */
export class OpenClawRuntime implements AgentRuntime {
  readonly id = "openclaw";
  readonly name = "OpenClaw (CLI)";

  async execute(prompt: string, config: RuntimeConfig): Promise<RuntimeResult> {
    const agentId = config.profile ?? "scout";
    const sessionKey = buildSessionKey(agentId);
    const timeoutMs = config.timeout || 60000;

    return new Promise((resolve) => {
      const sessionFile = getActiveSessionFile(agentId);
      const before = sessionFile ? readLastAssistantText(sessionFile) : "";

      const proc = spawn(
        "openclaw",
        ["chat", "--session", sessionKey, "--message", prompt, "--timeout-ms", String(timeoutMs)],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
        },
      );

      let stderr = "";

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve({ stdout: "", stderr: stderr || "Timeout", exitCode: 1 });
      }, timeoutMs + 10000);

      proc.on("close", (code) => {
        clearTimeout(timer);

        // Read session file to extract the new response
        const after = sessionFile ? readLastAssistantText(sessionFile) : "";

        let response = "";
        if (after && after !== before) {
          // If the new text starts with the old text (model edited/continued), take the diff
          if (before.length > 0 && after.startsWith(before)) {
            response = after.slice(before.length).trim();
          } else {
            response = after;
          }
        }

        resolve({ stdout: response || "[No response captured from session]", stderr, exitCode: code ?? 1 });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({ stdout: "", stderr: `OpenClaw CLI error: ${err.message}`, exitCode: 1 });
      });
    });
  }

  stream(prompt: string, config: RuntimeConfig, callbacks: StreamCallbacks): void {
    const agentId = config.profile ?? "scout";
    const sessionKey = buildSessionKey(agentId);
    const timeoutMs = config.timeout || 60000;

    const sessionFile = getActiveSessionFile(agentId);
    const before = sessionFile ? readLastAssistantText(sessionFile) : "";
    let sentLength = 0;
    let procKilled = false;

    const proc = spawn(
      "openclaw",
      ["chat", "--session", sessionKey, "--message", prompt, "--timeout-ms", String(timeoutMs)],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      },
    );

    // Poll session file for new content (500ms intervals for pseudo-streaming)
    const pollTimer = setInterval(() => {
      if (!sessionFile || procKilled) return;
      const current = readLastAssistantText(sessionFile);
      if (current.length > sentLength) {
        const chunk = current.slice(sentLength);
        callbacks.onData(chunk);
        sentLength = current.length;
      }
    }, 500);

    const timer = setTimeout(() => {
      cleanup();
      procKilled = true;
      proc.kill("SIGKILL");
      callbacks.onClose(1);
    }, timeoutMs + 10000);

    function cleanup() {
      clearTimeout(timer);
      clearInterval(pollTimer);
    }

    proc.on("close", (code) => {
      cleanup();
      if (procKilled) return;

      // Final read to flush any remaining content
      if (sessionFile) {
        const final = readLastAssistantText(sessionFile);
        if (final.length > sentLength) {
          callbacks.onData(final.slice(sentLength));
          sentLength = final.length;
        }
      }

      // Brief delay for file flush
      setTimeout(() => {
        if (sessionFile) {
          const last = readLastAssistantText(sessionFile);
          if (last.length > sentLength) {
            callbacks.onData(last.slice(sentLength));
          }
        }
        callbacks.onClose(code ?? 0);
      }, 300);
    });

    proc.on("error", (err) => {
      cleanup();
      callbacks.onError(`OpenClaw CLI error: ${err.message}`);
      callbacks.onClose(1);
    });
  }
}

/**
 * Stream a chat message to an OpenClaw agent.
 * Matches the signature expected by the copilot chat route.
 */
export async function streamOpenClawChat(
  sessionKey: string,
  message: string,
  callbacks: StreamCallbacks,
  _onDelta?: (payload: unknown) => void,
): Promise<void> {
  const runtime = new OpenClawRuntime();
  const agentId = sessionKey.replace("agent:", "").replace(":main", "");
  runtime.stream(message, { model: "default", profile: agentId }, callbacks);
}
