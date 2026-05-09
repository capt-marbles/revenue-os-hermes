import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import type { StreamCallbacks } from "@/lib/runtime/types";

// Hardcoded because launchd's PATH (`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)
// does not include ~/.local/bin where Claude Code installs its symlink.
// Override via CLAUDE_BIN env if installed elsewhere.
const CLAUDE_BIN =
  process.env.CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`;

// Resolved at module load. process.cwd() under the launchd-managed Next server
// is the project root (set via WorkingDirectory in the plist).
const PROJECT_ROOT = process.cwd();
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const MCP_SERVER_SCRIPT = path.join(PROJECT_ROOT, "scripts", "ros-tools-mcp.ts");

function readSoulPrompt(profile: string): string {
  const soulPath = `${process.env.HOME}/.hermes/profiles/${profile}/SOUL.md`;
  if (!existsSync(soulPath)) {
    return `You are the ${profile} agent for Gameye Revenue OS. Be concise, data-driven, and helpful.`;
  }
  return readFileSync(soulPath, "utf-8");
}

interface ClaudeCliOptions {
  /** Hermes profile slug — used to locate SOUL.md and as the MCP tool scope. */
  profile: string;
  /** Tenant id passed to the MCP server so tools execute in the right scope. */
  tenantId: string;
  /** Model alias (sonnet|haiku|opus) or full id. Defaults to sonnet. */
  model?: string;
}

/**
 * Run a chat turn via the local Claude Code CLI, streaming text deltas
 * through StreamCallbacks. Uses the user's Max subscription via OAuth —
 * no API tokens charged. Tool-calling is wired up via an MCP server
 * (`scripts/ros-tools-mcp.ts`) that exposes ROS's tool registry filtered
 * by the profile's tool scope.
 *
 * Trade-offs vs OpenRouter:
 *  - $0 marginal cost (subscription already paid)
 *  - ~5-hour rate-limit window
 *  - Only works while ROS runs on this machine (CC needs OAuth session)
 *  - Tool calls go through MCP stdio (extra subprocess per chat turn)
 */
export async function runClaudeCliChat(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  callbacks: StreamCallbacks,
  options: ClaudeCliOptions,
): Promise<void> {
  const { profile, tenantId, model = "sonnet" } = options;

  if (history.length === 0) {
    callbacks.onError("Empty conversation history.");
    callbacks.onClose(1);
    return;
  }

  const lastTurn = history[history.length - 1];
  if (lastTurn.role !== "user") {
    callbacks.onError(
      `Expected last history message to be from user, got ${lastTurn.role}.`,
    );
    callbacks.onClose(1);
    return;
  }

  const priorTurns = history.slice(0, -1);
  const soul = readSoulPrompt(profile);

  const conversationBlock =
    priorTurns.length > 0
      ? "\n\n## Prior conversation\n" +
        priorTurns
          .map(
            (m) =>
              `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
          )
          .join("\n\n")
      : "";

  const systemPrompt = `${soul}${conversationBlock}`;

  // MCP config: spawn ros-tools-mcp.ts as a child process scoped to this
  // profile + tenant. Claude CLI invokes it via stdio for tool calls.
  const mcpConfig = JSON.stringify({
    mcpServers: {
      "ros-tools": {
        command: TSX_BIN,
        args: [MCP_SERVER_SCRIPT],
        env: {
          ROS_SCOPE: profile,
          ROS_TENANT_ID: tenantId,
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
        },
      },
    },
  });

  // Flag breakdown:
  //  --setting-sources ""        — skip hooks/CLAUDE.md (keeps OAuth, unlike --bare)
  //  --tools ""                  — disable CC's built-in Read/Bash/Edit; only MCP tools available
  //  --disable-slash-commands    — don't try to interpret user input as /skill
  //  --strict-mcp-config         — only load our MCP server, ignore system-wide ones
  //  --permission-mode bypassPermissions — pre-approve MCP tool calls (we own the server)
  //  --output-format stream-json --include-partial-messages — stream text deltas
  const args = [
    "--print",
    "--verbose",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--tools",
    "",
    "--disable-slash-commands",
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--model",
    model,
    "--system-prompt",
    systemPrompt,
    lastTurn.content,
  ];

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(CLAUDE_BIN, args, {
      cwd: "/tmp",
      env: { ...process.env, NO_COLOR: "1" },
    });
  } catch (err) {
    callbacks.onError(
      `Failed to spawn claude (${CLAUDE_BIN}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    callbacks.onClose(1);
    return;
  }

  let stdoutBuf = "";
  let stderrBuf = "";
  let closed = false;
  let cliErrorMessage: string | null = null;

  proc.stdout!.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (
        evt.type === "stream_event" &&
        typeof evt.event === "object" &&
        evt.event !== null
      ) {
        const event = evt.event as Record<string, unknown>;
        if (event.type === "content_block_delta") {
          const delta = event.delta as
            | { type?: string; text?: string }
            | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            callbacks.onData(delta.text);
          }
        }
      } else if (evt.type === "result" && evt.is_error) {
        cliErrorMessage = String(evt.result ?? "Claude CLI returned an error");
      }
    }
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });

  proc.on("error", (err) => {
    if (closed) return;
    closed = true;
    callbacks.onError(`Claude CLI process error: ${err.message}`);
    callbacks.onClose(1);
  });

  proc.on("close", (code) => {
    if (closed) return;
    closed = true;
    if (cliErrorMessage) {
      callbacks.onError(cliErrorMessage);
      callbacks.onClose(1);
      return;
    }
    if (code !== 0) {
      const detail = stderrBuf.slice(0, 500) || `exit code ${code}`;
      callbacks.onError(`Claude CLI exited ${code}: ${detail}`);
      callbacks.onClose(1);
      return;
    }
    callbacks.onClose(0);
  });
}
