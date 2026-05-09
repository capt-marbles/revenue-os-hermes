import type { RegisteredTool } from "./types";

const AGENT_PORTS: Record<string, number> = {
  scout: 8643,
  outreach: 8644,
  steward: 8645,
  marketing: 8646,
  "sales-engineering": 8647,
  "chief-of-staff": 8648,
  leo: 8649,
};

const AGENT_DESCRIPTIONS: Record<string, string> = {
  scout: "market research, ICP analysis, studio/prospect identification, competitive intelligence",
  steward: "CRM status, deal updates, contact management, pipeline changes",
  outreach: "email sequence performance, reply rates, bounce analysis, active campaigns",
  marketing: "website content, SEO, landing pages, brand messaging",
  "sales-engineering": "technical evaluations, demo prep, integration questions",
  leo: "GBrain knowledge search, session history, memory retrieval — use when looking for past work, outputs, or research any agent has done",
};

export const dispatchAgent: RegisteredTool = {
  definition: {
    name: "dispatch_agent",
    description: `Send a query to a specialist agent and get their full response inline.
Use when you need live analysis that only a specialist can provide:
- scout: ${AGENT_DESCRIPTIONS.scout}
- steward: ${AGENT_DESCRIPTIONS.steward}
- outreach: ${AGENT_DESCRIPTIONS.outreach}
- marketing: ${AGENT_DESCRIPTIONS.marketing}
- sales-engineering: ${AGENT_DESCRIPTIONS["sales-engineering"]}

Prefer this over guessing from stale briefing data when the operator needs current state from a specific domain.`,
    input_schema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["scout", "steward", "outreach", "marketing", "sales-engineering", "leo"],
          description: "Which specialist agent to query",
        },
        query: {
          type: "string",
          description: "The question or task to send. Be specific — the agent has no conversation history.",
        },
        timeout: {
          type: "number",
          description: "Max seconds to wait (default 45, max 120)",
        },
      },
      required: ["agent", "query"],
    },
  },
  scopes: ["cos"],
  async execute(input) {
    const agent = input.agent as string;
    const query = input.query as string;
    const timeoutMs = Math.min((input.timeout as number | undefined) ?? 45, 120) * 1000;

    const port = AGENT_PORTS[agent];
    if (!port) return `Unknown agent: ${agent}. Valid agents: ${Object.keys(AGENT_PORTS).join(", ")}`;

    // Each agent's Hermes instance has its own port; HERMES_WEBAPI_URL overrides for all
    const baseUrl = process.env[`HERMES_${agent.toUpperCase().replace("-", "_")}_URL`]
      ?? process.env.HERMES_WEBAPI_URL
      ?? `http://localhost:${port}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "hermes-agent",
          messages: [{ role: "user", content: query }],
          stream: true,
          profile: agent,
        }),
      });

      if (!res.ok || !res.body) {
        return `${agent} agent unavailable (HTTP ${res.status}). It may not be running.`;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim().startsWith("data: ")) continue;
          const payload = line.trim().slice(6);
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) content += chunk;
          } catch {
            // skip malformed chunks
          }
        }
      }

      if (!content) return `${agent} agent returned an empty response.`;

      const MAX = 4000;
      const header = `## Response from ${agent} agent\n\n`;
      if (content.length > MAX) {
        return header + content.slice(0, MAX) + "\n\n[...truncated — ask the operator to check the full output in the " + agent + " tab]";
      }
      return header + content;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return `${agent} agent timed out after ${timeoutMs / 1000}s. It may be working on a long task — ask the operator to check the ${agent} tab directly.`;
      }
      return `${agent} agent error: ${(err as Error).message}`;
    } finally {
      clearTimeout(timer);
    }
  },
};
