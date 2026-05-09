import { spawn } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AgentRuntime, RuntimeConfig, RuntimeResult, StreamCallbacks } from "./types";

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_TMP_ROOT = process.env.REVENUE_OS_CODEX_TMP_ROOT || path.join(os.tmpdir(), "revenue-os-codex");
const DEFAULT_CODEX_HOME =
  process.env.REVENUE_OS_CODEX_HOME ||
  process.env.CODEX_HOME ||
  path.join(os.homedir(), ".codex");

interface SpawnContext {
  args: string[];
  env: NodeJS.ProcessEnv;
  outputFile: string;
  cleanup: () => void;
}

export class CodexRuntime implements AgentRuntime {
  readonly id = "codex";
  readonly name = "Codex (OpenAI)";

  async execute(prompt: string, config: RuntimeConfig): Promise<RuntimeResult> {
    const { args, env, outputFile, cleanup } = this.prepareSpawn(config);

    return new Promise((resolve) => {
      const proc = spawn(CODEX_BIN, args, {
        timeout: config.timeout ?? 300000,
        env,
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      if (config.signal) {
        config.signal.addEventListener(
          "abort",
          () => {
            proc.kill("SIGINT");
          },
          { once: true },
        );
      }

      proc.stdin.write(prompt);
      proc.stdin.end();

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const finalMessage = this.readFinalMessage(outputFile);
        const parsedErrors = this.extractCodexErrors(stdout);
        cleanup();
        resolve({
          stdout: finalMessage || stdout,
          stderr: parsedErrors || stderr,
          exitCode: code ?? 1,
        });
      });

      proc.on("error", (err) => {
        cleanup();
        resolve({
          stdout: "",
          stderr: `Spawn error: ${err.message}. Is Codex CLI installed and authenticated?`,
          exitCode: 1,
        });
      });
    });
  }

  stream(prompt: string, config: RuntimeConfig, callbacks: StreamCallbacks): void {
    (async () => {
      const result = await this.execute(prompt, config);
      if (result.exitCode !== 0) {
        callbacks.onError(result.stderr || "Codex runtime failed");
        callbacks.onClose(result.exitCode);
        return;
      }
      if (result.stdout) {
        callbacks.onData(result.stdout);
      }
      callbacks.onClose(0);
    })().catch((err) => {
      callbacks.onError(err instanceof Error ? err.message : String(err));
      callbacks.onClose(1);
    });
  }

  private prepareSpawn(config: RuntimeConfig): SpawnContext {
    mkdirSync(CODEX_TMP_ROOT, { recursive: true });
    const tmpDir = mkdtempSync(path.join(CODEX_TMP_ROOT, "run-"));
    const outputFile = path.join(tmpDir, "last-message.txt");
    const sandboxMode = config.sandboxMode ?? "workspace-write";

    const args = [
      "exec",
      "-",
      "--json",
      "--ephemeral",
      "--color",
      "never",
      "--sandbox",
      sandboxMode,
      "--full-auto",
      "--output-last-message",
      outputFile,
      "--model",
      config.model,
    ];

    const env = {
      ...process.env,
      CODEX_HOME: DEFAULT_CODEX_HOME,
      NO_COLOR: "1",
    };

    return {
      args,
      env,
      outputFile,
      cleanup: () => {
        rmSync(tmpDir, { recursive: true, force: true });
      },
    };
  }

  private readFinalMessage(outputFile: string): string {
    try {
      return readFileSync(outputFile, "utf-8").trim();
    } catch {
      return "";
    }
  }

  private extractCodexErrors(stdout: string): string {
    const messages: string[] = [];

    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;

      try {
        const parsed = JSON.parse(trimmed) as { type?: string; message?: string };
        if (parsed.type === "error" && typeof parsed.message === "string") {
          messages.push(parsed.message);
        }
      } catch {
        continue;
      }
    }

    return messages.join("\n");
  }
}
