import type { RegisteredTool } from "./types";

export const scoutSteamLookup: RegisteredTool = {
  definition: {
    name: "steam_lookup",
    description: `Look up game studio data from Steam.
Use to validate a studio's games are live, check player counts, and confirm they're still active.

Two modes:
- search: find games/studios by name
- app: get full details for a known Steam App ID (CCU, developer, publisher, tags)`,
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["search", "app"],
          description: "search = find by name, app = get details by App ID",
        },
        query: { type: "string", description: "Studio or game name (for search mode)" },
        app_id: { type: "number", description: "Steam App ID (for app mode)" },
      },
      required: ["mode"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    const mode = String(input.mode);

    if (mode === "search") {
      const query = String(input.query ?? "").trim();
      if (!query) return "steam_lookup: query required for search mode";

      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`;
      const res = await fetch(url, { headers: { "User-Agent": "revenue-os-scout" } });
      if (!res.ok) return `Steam search failed: HTTP ${res.status}`;

      const data = await res.json();
      const items = data.items ?? [];
      if (items.length === 0) return `No Steam results for: ${query}`;

      const lines = items.slice(0, 10).map((item: Record<string, unknown>, i: number) => {
        const name = String(item.name ?? "Unknown");
        const appid = item.id;
        const price = (item.price as Record<string, unknown>)?.final
          ? `$${(Number((item.price as Record<string, unknown>).final) / 100).toFixed(2)}`
          : "Free/Unknown";
        return `${i + 1}. **${name}** (App ID: ${appid}) · ${price}\n   https://store.steampowered.com/app/${appid}`;
      });

      return `## Steam Search: "${query}"\n\n${lines.join("\n\n")}`;
    }

    if (mode === "app") {
      const appId = Number(input.app_id);
      if (!appId) return "steam_lookup: app_id required for app mode";

      const url = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
      const res = await fetch(url, { headers: { "User-Agent": "revenue-os-scout" } });
      if (!res.ok) return `Steam app lookup failed: HTTP ${res.status}`;

      const data = await res.json();
      const appData = data[String(appId)];
      if (!appData?.success) return `No Steam data found for App ID ${appId}`;

      const d = appData.data ?? {};
      const developers = (d.developers ?? []).join(", ") || "Unknown";
      const publishers = (d.publishers ?? []).join(", ") || "Unknown";
      const genres = (d.genres ?? []).map((g: Record<string, unknown>) => g.description).join(", ");
      const categories = (d.categories ?? []).map((c: Record<string, unknown>) => c.description).join(", ");
      const releaseDate = d.release_date?.date ?? "Unknown";
      const isFree = d.is_free ? "Free" : d.price_overview?.final_formatted ?? "Paid";

      return [
        `## Steam App ${appId}: ${d.name ?? "Unknown"}`,
        `**Developer:** ${developers}`,
        `**Publisher:** ${publishers}`,
        `**Released:** ${releaseDate} · ${isFree}`,
        `**Genres:** ${genres}`,
        `**Categories:** ${categories}`,
        `**Short description:** ${d.short_description ?? ""}`,
        `**URL:** https://store.steampowered.com/app/${appId}`,
      ].join("\n");
    }

    return `Unknown mode: ${mode}`;
  },
};
