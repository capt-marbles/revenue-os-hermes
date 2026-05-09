import Anthropic from "@anthropic-ai/sdk";
import { ALL_TOOLS, getToolsForAgent } from "@/lib/tools";
import type { StreamCallbacks } from "@/lib/runtime/types";

const MAX_TOOL_ROUNDS = 4;

// Singleton client — reused across requests
const anthropic = new Anthropic();

/**
 * Run an agentic CoS chat turn using the official Anthropic SDK.
 *
 * Every round streams text deltas in real-time. Tool-call rounds forward any
 * interim text but keep looping; the final end_turn response streams directly
 * to the client. Prompt caching is enabled on the system prompt so the large
 * briefing block is served from cache on every tool round in a single session.
 */
export async function runCoSAgenticChat(
  systemPrompt: string,
  history: Anthropic.MessageParam[],
  model: string,
  callbacks: StreamCallbacks,
  tenantId: string,
): Promise<void> {
  const toolSet = getToolsForAgent(ALL_TOOLS, "cos", tenantId);
  const messages: Anthropic.MessageParam[] = [...history];
  let rounds = 0;

  // Cache the large system prompt (briefing + instructions) across tool rounds.
  // Each conversation session reuses the same system prompt for all rounds so
  // the first round writes the cache and subsequent rounds read at ~0.1× cost.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const isLastRound = rounds === MAX_TOOL_ROUNDS;

    let stream: ReturnType<typeof anthropic.messages.stream>;
    try {
      stream = anthropic.messages.stream({
        model,
        max_tokens: 8192,
        system,
        // On the last round, disable tools so the model is forced to answer
        ...(toolSet.definitions.length > 0 && !isLastRound
          ? { tools: toolSet.definitions as Anthropic.Tool[] }
          : {}),
        messages,
      });
    } catch (err) {
      callbacks.onError(
        `Anthropic SDK error: ${err instanceof Error ? err.message : String(err)}`,
      );
      callbacks.onClose(1);
      return;
    }

    // Stream text deltas as they arrive — works for both interim and final turns
    stream.on("text", (delta: string) => callbacks.onData(delta));

    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        callbacks.onError("Rate limited — please try again shortly.");
      } else if (err instanceof Anthropic.AuthenticationError) {
        callbacks.onError("ANTHROPIC_API_KEY is invalid or missing.");
      } else {
        callbacks.onError(
          `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      callbacks.onClose(1);
      return;
    }

    if (message.stop_reason !== "tool_use") {
      callbacks.onClose(0);
      return;
    }

    // Extract tool calls — strip text narration blocks so they don't accumulate
    // in history and bleed into subsequent rounds.
    const toolBlocks = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    messages.push({ role: "assistant", content: toolBlocks });

    const results = await Promise.all(
      toolBlocks.map(async (block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: await toolSet.execute(block.name, block.input as Record<string, unknown>),
      })),
    );

    messages.push({ role: "user", content: results });
  }

  // Should not reach here since the last round disables tools and forces end_turn,
  // but guard anyway.
  callbacks.onError("Tool call limit reached without a final response.");
  callbacks.onClose(1);
}
