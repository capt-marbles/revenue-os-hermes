import type { AgentRuntime, RuntimeConfig, RuntimeResult, StreamCallbacks } from "./types";

/**
 * Antbase.ai smart routing runtime.
 *
 * Routes requests through Antbase's multi-stage classifier to the optimal
 * model across 12,500+ models on 30+ providers.
 *
 * Env vars:
 *   ANTBASE_API_KEY  — required, format: ant_*
 *
 * Virtual routing models:
 *   ant:auto        — smart routing (default)
 *   ant:fast        — lowest latency
 *   ant:balanced    — quality + speed balance
 *   ant:best        — highest quality
 *   ant:reasoning   — deep thinking / complex reasoning
 *
 * Any specific model ID (e.g. "anthropic/claude-sonnet-4-20250514") also works.
 */

const ANTBASE_BASE_URL = "https://antbase.ai/v1";

export class AntbaseRuntime implements AgentRuntime {
  readonly id = "antbase";
  readonly name = "Antbase Smart Router";

  async execute(prompt: string, config: RuntimeConfig): Promise<RuntimeResult> {
    const apiKey = process.env.ANTBASE_API_KEY;
    if (!apiKey) {
      return { stdout: "", stderr: "ANTBASE_API_KEY not set", exitCode: 1 };
    }

    const model = config.model || "ant:auto";

    try {
      const res = await fetch(`${ANTBASE_BASE_URL}/chat/completions`, {
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
        signal: config.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        return { stdout: "", stderr: `Antbase API ${res.status}: ${text}`, exitCode: 1 };
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;

      return {
        stdout: text,
        stderr: "",
        exitCode: 0,
        tokensUsed: inputTokens + outputTokens,
        // Antbase bills at the underlying model's rate — use a conservative estimate
        costEstimate: (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stdout: "", stderr: message, exitCode: 1 };
    }
  }

  stream(prompt: string, config: RuntimeConfig, callbacks: StreamCallbacks): void {
    const apiKey = process.env.ANTBASE_API_KEY;
    if (!apiKey) {
      callbacks.onError("ANTBASE_API_KEY not set");
      callbacks.onClose(1);
      return;
    }

    const model = config.model || "ant:auto";

    (async () => {
      try {
        const res = await fetch(`${ANTBASE_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 8192,
            messages: [{ role: "user", content: prompt }],
            stream: true,
          }),
          signal: config.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => `HTTP ${res.status}`);
          callbacks.onError(`Antbase API ${res.status}: ${text}`);
          callbacks.onClose(1);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) callbacks.onData(content);
            } catch {
              // skip malformed chunk
            }
          }
        }

        callbacks.onClose(0);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          callbacks.onClose(0);
        } else {
          callbacks.onError(err instanceof Error ? err.message : String(err));
          callbacks.onClose(1);
        }
      }
    })();
  }
}
