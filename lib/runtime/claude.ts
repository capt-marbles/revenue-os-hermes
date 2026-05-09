import { spawn } from "child_process";
import type { AgentRuntime, RuntimeConfig, RuntimeResult, StreamCallbacks } from "./types";

export class ClaudeRuntime implements AgentRuntime {
  readonly id = "claude";
  readonly name = "Claude (CLI)";

  async execute(prompt: string, config: RuntimeConfig): Promise<RuntimeResult> {
    const args = this.buildArgs(config, true);

    return new Promise((resolve) => {
      const proc = spawn("claude", args, {
        timeout: config.timeout ?? 300000,
        env: { ...process.env },
      });

      proc.stdin.write(prompt);
      proc.stdin.end();

      let stdout = "";
      let stderr = "";

      if (config.signal) {
        config.signal.addEventListener("abort", () => {
          proc.kill("SIGINT");
        }, { once: true });
      }

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          console.error(`[ClaudeRuntime] execute exited ${code} | stderr: ${stderr.slice(0, 300)} | stdout: ${stdout.slice(0, 300)}`);
        }

        let tokensUsed: number | undefined;
        let costEstimate: number | undefined;

        // Try to extract usage from JSON output
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.usage) {
            tokensUsed = (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0);
          }
          if (parsed.cost_usd !== undefined) {
            costEstimate = parsed.cost_usd;
          }
        } catch {
          // Not JSON — fine
        }

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          tokensUsed,
          costEstimate,
        });
      });

      proc.on("error", (err) => {
        resolve({
          stdout: "",
          stderr: `Spawn error: ${err.message}`,
          exitCode: 1,
        });
      });
    });
  }

  stream(prompt: string, config: RuntimeConfig, callbacks: StreamCallbacks): void {
    // Streaming mode: no --output-format json, raw text output
    const args = this.buildArgs(config, false);

    const proc = spawn("claude", args, {
      timeout: config.timeout ?? 300000,
      env: { ...process.env },
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on("data", (chunk: Buffer) => {
      callbacks.onData(chunk.toString());
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      callbacks.onError(chunk.toString());
    });

    proc.on("close", (code) => {
      callbacks.onClose(code ?? 1);
    });

    proc.on("error", (err) => {
      callbacks.onError(`Spawn error: ${err.message}`);
      callbacks.onClose(1);
    });
  }

  private buildArgs(config: RuntimeConfig, jsonOutput: boolean): string[] {
    const args = [
      "-p",
      "-",
      "--model",
      config.model,
    ];

    if (jsonOutput) {
      args.push("--output-format", "json");
    }

    args.push("--max-turns", String(config.maxTurns ?? 10));
    args.push("--dangerously-skip-permissions");

    if (config.tools && config.tools.length > 0) {
      args.push("--allowedTools", config.tools.join(","));
    }

    if (config.mcpConfigPath) {
      args.push("--mcp-config", config.mcpConfigPath);
    }

    return args;
  }
}
