import type { RegisteredTool } from "./types";

const SUBREDDITS = [
  "gamedev",
  "indiegaming",
  "indiegames",
  "unrealengine",
  "Unity3D",
  "gamedesign",
  "gameservers",
].join("+");

export const scoutRedditSearch: RegisteredTool = {
  definition: {
    name: "reddit_search",
    description: `Search Reddit for game developer discussions about server hosting, migrations, and pain points.
Monitors gamedev, indiegaming, Unity3D, and unrealengine subreddits by default.

Best queries:
- "multiplay migration alternative"
- "hathora shut down replacement"
- "dedicated server hosting game"
- "server hosting costs" OR "server infrastructure"`,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        subreddit: { type: "string", description: "Specific subreddit to search (optional — defaults to combined gamedev communities)" },
        sort: {
          type: "string",
          enum: ["new", "relevance", "top"],
          description: "Sort order (default: new — catches fresh discussions)",
        },
        limit: { type: "number", description: "Number of results (default 10, max 25)" },
      },
      required: ["query"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    const query = String(input.query);
    const sort = String(input.sort ?? "new");
    const limit = Math.min(Number(input.limit ?? 10), 25);
    const subreddit = input.subreddit ? String(input.subreddit) : SUBREDDITS;

    const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&limit=${limit}&restrict_sr=1`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "revenue-os-scout/1.0",
        Accept: "application/json",
      },
    });

    if (res.status === 429) return "Reddit rate limit hit — wait a minute and retry.";
    if (!res.ok) return `Reddit search failed: HTTP ${res.status}`;

    const data = await res.json();
    const posts = data.data?.children ?? [];

    if (posts.length === 0) return `No Reddit results for: ${query}`;

    const lines = posts.map((p: Record<string, unknown>, i: number) => {
      const d = (p as { data?: Record<string, unknown> }).data ?? {};
      const title = String(d.title ?? "Untitled");
      const sub = String(d.subreddit_name_prefixed ?? "r/?");
      const score = Number(d.score ?? 0);
      const comments = Number(d.num_comments ?? 0);
      const created = d.created_utc
        ? new Date(Number(d.created_utc) * 1000).toISOString().slice(0, 10)
        : "";
      const url = `https://reddit.com${d.permalink ?? ""}`;
      const snippet = String(d.selftext ?? "").slice(0, 300).replace(/\n/g, " ");

      return [
        `${i + 1}. **${title}**`,
        `   ${sub} · ⬆️${score} · 💬${comments} · ${created}`,
        `   ${url}`,
        snippet ? `   ${snippet}…` : "",
      ].filter(Boolean).join("\n");
    });

    return `## Reddit: "${query}" in r/${subreddit} (${posts.length} results)\n\n${lines.join("\n\n")}`;
  },
};
