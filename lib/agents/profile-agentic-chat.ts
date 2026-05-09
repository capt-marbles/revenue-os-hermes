import { existsSync, readFileSync } from "fs";
import { ALL_TOOLS, getToolsForAgent } from "@/lib/tools";
import type { ToolScope } from "@/lib/tools/types";
import type { StreamCallbacks } from "@/lib/runtime/types";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const MAX_TOOL_ROUNDS = 6;

// Per-profile model overrides — desks that need stronger reasoning get a better model.
const PROFILE_MODELS: Record<string, string> = {
  steward: "anthropic/claude-haiku-4-5",
  scout: "anthropic/claude-haiku-4-5",
};
const STREAM_CHUNK = 40;

type OAIMessage = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

function toOpenAITool(def: {
  name: string;
  description: string;
  input_schema: unknown;
}) {
  return {
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.input_schema,
    },
  };
}

function readSoulPrompt(profile: string): string {
  // Prefer the in-repo copy so SOUL.md is version-controlled alongside the code.
  // Fall back to the Hermes profile directory for local overrides / legacy setup.
  const repoPaths = [
    `${process.cwd()}/agents/${profile}/SOUL.md`,
    `${process.cwd()}/../agents/${profile}/SOUL.md`,
  ];
  for (const p of repoPaths) {
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  const hermes = `${process.env.HOME}/.hermes/profiles/${profile}/SOUL.md`;
  if (existsSync(hermes)) return readFileSync(hermes, "utf-8");
  return `You are the ${profile} agent for Gameye Revenue OS. Be concise, data-driven, and helpful.`;
}

interface ProfileChatOptions {
  /** Hermes profile slug — used to locate SOUL.md and as the default tool scope. */
  profile: string;
  /** Tool scope override. Defaults to the profile slug. */
  toolScope?: ToolScope;
  /** OpenRouter model override. Defaults to openai/gpt-4o-mini. */
  model?: string;
}

/**
 * Run a profile-scoped agentic turn via OpenRouter with OpenAI-format
 * tool calling. The system prompt is read from the profile's SOUL.md;
 * tools are filtered by the profile's tool scope.
 *
 * Replaces the old Hermes gateway dispatch — no daemon dependency.
 */
export async function runProfileAgenticChat(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  callbacks: StreamCallbacks,
  tenantId: string,
  options: ProfileChatOptions,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    callbacks.onError("OPENROUTER_API_KEY not set — add it to .env.local");
    callbacks.onClose(1);
    return;
  }

  const {
    profile,
    toolScope = profile as ToolScope,
    model = PROFILE_MODELS[profile] ?? DEFAULT_MODEL,
  } = options;

  const systemPrompt = readSoulPrompt(profile);
  const toolSet = getToolsForAgent(ALL_TOOLS, toolScope, tenantId);
  const openAITools = toolSet.definitions.map(toOpenAITool);
  const hasTools = openAITools.length > 0;

  const messages: OAIMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let res: Response;
    try {
      res = await fetch(OPENROUTER_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://gameye.com",
          "X-Title": `Revenue OS - ${profile}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          tools: hasTools ? openAITools : undefined,
          tool_choice: hasTools ? "auto" : undefined,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
        }),
      });
    } catch (err) {
      callbacks.onError(
        `OpenRouter request failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      callbacks.onClose(1);
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      callbacks.onError(`OpenRouter ${res.status}: ${body}`);
      callbacks.onClose(1);
      return;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const finishReason: string = choice?.finish_reason ?? "stop";
    const msg = choice?.message;

    if (finishReason === "tool_calls" && msg?.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      const toolResults: OAIMessage[] = await Promise.all(
        msg.tool_calls.map(
          async (tc: {
            id: string;
            function: { name: string; arguments: string };
          }) => {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(tc.function.arguments);
            } catch {}
            const result = await toolSet.execute(tc.function.name, input);
            return {
              role: "tool" as const,
              tool_call_id: tc.id,
              content: result,
            };
          },
        ),
      );

      messages.push(...toolResults);
      continue;
    }

    const text: string = msg?.content ?? "";
    for (let i = 0; i < text.length; i += STREAM_CHUNK) {
      callbacks.onData(text.slice(i, i + STREAM_CHUNK));
    }
    callbacks.onClose(0);
    return;
  }

  callbacks.onError("Tool call limit reached without a final response.");
  callbacks.onClose(1);
}
