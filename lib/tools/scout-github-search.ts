import type { RegisteredTool } from "./types";

const GH_API = "https://api.github.com";

export const scoutGithubSearch: RegisteredTool = {
  definition: {
    name: "github_search",
    description: `Search GitHub for game studios using specific server hosting SDKs.
Use code search to find repos with Multiplay, Hathora, or Pragma dependencies in config files.
Use repo search to find studios by topic or technology.

Signal examples:
- code: "hathora-sdk" filename:package.json — hard evidence a studio used Hathora
- code: "com.unity.services.multiplay" filename:*.json — Unity Multiplay dependency
- repos: "game server" "multiplayer" topic:unity
- code: "pragma-engine" — Pragma Platform users`,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        type: {
          type: "string",
          enum: ["code", "repositories"],
          description: "Search type: 'code' for dependency files, 'repositories' for whole repos (default: code)",
        },
        per_page: { type: "number", description: "Results per page (default 15, max 30)" },
      },
      required: ["query"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    const query = String(input.query);
    const type = String(input.type ?? "code");
    const perPage = Math.min(Number(input.per_page ?? 15), 30);
    const token = process.env.GITHUB_TOKEN;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "revenue-os-scout",
    };
    if (token) headers["Authorization"] = `token ${token}`;

    const endpoint = type === "repositories" ? "search/repositories" : "search/code";
    const url = `${GH_API}/${endpoint}?q=${encodeURIComponent(query)}&per_page=${perPage}`;

    const res = await fetch(url, { headers });

    if (res.status === 403) return "GitHub rate limit hit. Set GITHUB_TOKEN in .env.local for 5000 req/hr instead of 60.";
    if (!res.ok) {
      const err = await res.text().catch(() => `HTTP ${res.status}`);
      return `GitHub search failed: ${err}`;
    }

    const data = await res.json();
    const items = data.items ?? [];
    const total = data.total_count ?? 0;

    if (items.length === 0) return `No GitHub results for: ${query}`;

    if (type === "repositories") {
      const lines = items.map((r: Record<string, unknown>, i: number) => {
        const repo = r as { full_name?: string; html_url?: string; description?: string; stargazers_count?: number; updated_at?: string };
        const stars = repo.stargazers_count ?? 0;
        const updated = repo.updated_at ? String(repo.updated_at).slice(0, 10) : "";
        return `${i + 1}. **${repo.full_name}** ⭐${stars} · updated ${updated}\n   ${repo.html_url}\n   ${repo.description ?? ""}`;
      });
      return `## GitHub Repos: "${query}" (${total} total, showing ${items.length})\n\n${lines.join("\n\n")}`;
    }

    const lines = items.map((r: Record<string, unknown>, i: number) => {
      const item = r as { path?: string; html_url?: string; repository?: { full_name?: string; html_url?: string } };
      return `${i + 1}. **${item.repository?.full_name ?? "unknown"}** — \`${item.path}\`\n   ${item.html_url}`;
    });
    return `## GitHub Code: "${query}" (${total} total, showing ${items.length})\n\n${lines.join("\n\n")}`;
  },
};
