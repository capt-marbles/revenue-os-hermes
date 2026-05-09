import type { AgentRuntime, RuntimeConfig, RuntimeResult, StreamCallbacks } from "./types";

/**
 * Direct API runtime — calls Anthropic or OpenAI-compatible APIs via fetch.
 *
 * No CLI dependency. Set AGENT_RUNTIME=direct-api to use.
 *
 * Env vars:
 *   DIRECT_API_MODEL        — model name (default: claude-sonnet-4-20250514)
 *   DIRECT_API_PROVIDER     — "anthropic" | "openai" (default: auto-detect)
 *   ANTHROPIC_API_KEY       — required for Claude models
 *   OPENAI_API_BASE_URL     — base URL for OpenAI-compatible (e.g. OpenRouter)
 *   OPENAI_API_KEY          — key for OpenAI-compatible endpoint
 */

function detectProvider(model: string): "anthropic" | "openai" {
  const forced = process.env.DIRECT_API_PROVIDER as string | undefined;
  if (forced === "anthropic" || forced === "openai") return forced;
  // Claude models use Anthropic, everything else uses OpenAI-compatible
  if (model.startsWith("claude")) return "anthropic";
  return "openai";
}

export class DirectApiRuntime implements AgentRuntime {
  readonly id = "direct-api";
  readonly name = "Direct API (Anthropic / OpenAI-compatible)";

  async execute(prompt: string, config: RuntimeConfig): Promise<RuntimeResult> {
    const model = config.model || process.env.DIRECT_API_MODEL || "claude-sonnet-4-20250514";
    const provider = detectProvider(model);

    try {
      if (provider === "anthropic") {
        return await this.callAnthropic(prompt, model);
      }
      return await this.callOpenAI(prompt, model);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stdout: "", stderr: message, exitCode: 1 };
    }
  }

  stream(prompt: string, config: RuntimeConfig, callbacks: StreamCallbacks): void {
    // TODO: Implement true SSE streaming for both Anthropic and OpenAI.
    // For now, fall back to execute() and deliver the full result at once.
    (async () => {
      const result = await this.execute(prompt, config);
      if (result.exitCode !== 0 && result.stderr) {
        callbacks.onError(result.stderr);
      }
      if (result.stdout) {
        callbacks.onData(result.stdout);
      }
      callbacks.onClose(result.exitCode);
    })().catch((err) => {
      callbacks.onError(err instanceof Error ? err.message : String(err));
      callbacks.onClose(1);
    });
  }

  private async callAnthropic(prompt: string, model: string): Promise<RuntimeResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { stdout: "", stderr: "ANTHROPIC_API_KEY not set", exitCode: 1 };
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { stdout: "", stderr: `Anthropic API ${res.status}: ${text}`, exitCode: 1 };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text ?? "";
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    // Approximate Claude Sonnet 4 pricing
    const costEstimate = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);

    return {
      stdout: text,
      stderr: "",
      exitCode: 0,
      tokensUsed: inputTokens + outputTokens,
      costEstimate,
    };
  }

  private async callOpenAI(prompt: string, model: string): Promise<RuntimeResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";

    if (!apiKey) {
      return { stdout: "", stderr: "OPENAI_API_KEY not set", exitCode: 1 };
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { stdout: "", stderr: `OpenAI API ${res.status}: ${text}`, exitCode: 1 };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    // Rough cost estimate (varies by provider)
    const costEstimate = (inputTokens * 2 / 1_000_000) + (outputTokens * 8 / 1_000_000);

    return {
      stdout: text,
      stderr: "",
      exitCode: 0,
      tokensUsed: inputTokens + outputTokens,
      costEstimate,
    };
  }
}
