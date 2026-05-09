import type { RegisteredTool } from "./types";

const EXA_API = "https://api.exa.ai/search";

export const scoutWebSearch: RegisteredTool = {
  definition: {
    name: "web_search",
    description: `Search the web for signals about game studios, server hosting migrations, and market intelligence.
Uses Exa semantic search — better than keyword search for finding nuanced signals like "studio migrating from Multiplay" or "hathora alternative".

Best queries:
- "Unity Multiplay shutdown migration alternative 2026"
- "Hathora game server hosting replacement"
- "dedicated server hosting indie game studio"
- Studio names + "server" or "hosting"`,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — be specific for best results" },
        num_results: { type: "number", description: "Number of results (default 10, max 25)" },
        include_text: { type: "boolean", description: "Include full page text snippets (default false — slower but richer)" },
        date_after: { type: "string", description: "Only results after this date (YYYY-MM-DD)" },
      },
      required: ["query"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      return "EXA_API_KEY not set. Add it to .env.local — get a free key at dashboard.exa.ai";
    }

    const query = String(input.query);
    const numResults = Math.min(Number(input.num_results ?? 10), 25);
    const includeText = Boolean(input.include_text);
    const dateAfter = input.date_after ? String(input.date_after) : undefined;

    const body: Record<string, unknown> = {
      query,
      numResults,
      useAutoprompt: true,
      type: "auto",
    };
    if (includeText) body.contents = { text: { maxCharacters: 800 } };
    if (dateAfter) body.startPublishedDate = dateAfter;

    const res = await fetch(EXA_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => `HTTP ${res.status}`);
      return `Exa search failed: ${err}`;
    }

    const data = await res.json();
    const results = data.results ?? [];

    if (results.length === 0) return "No results found.";

    const lines = results.map((r: Record<string, unknown>, i: number) => {
      const title = r.title ?? "Untitled";
      const url = r.url ?? "";
      const published = r.publishedDate ? ` · ${String(r.publishedDate).slice(0, 10)}` : "";
      const snippet = (r.text as string | undefined)?.slice(0, 400) ?? r.summary ?? "";
      return `${i + 1}. **${title}**${published}\n   ${url}${snippet ? `\n   ${snippet}` : ""}`;
    });

    return `## Web Search: "${query}" (${results.length} results)\n\n${lines.join("\n\n")}`;
  },
};
