import type { RegisteredTool } from "./types";

export const scoutWayback: RegisteredTool = {
  definition: {
    name: "wayback_check",
    description: `Check if a domain/URL is still active using the Wayback Machine.
Use to detect defunct studios (domain expired/parked) or find historical hosting references on old pages.

Returns the most recent snapshot date and whether the site appears active.`,
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Domain or URL to check (e.g. studiox.com or studiox.com/tech)" },
      },
      required: ["url"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    const url = String(input.url).trim().replace(/^https?:\/\//, "");

    const availRes = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { headers: { "User-Agent": "revenue-os-scout" } },
    );

    if (!availRes.ok) return `Wayback Machine unavailable: HTTP ${availRes.status}`;

    const avail = await availRes.json();
    const snapshot = avail.archived_snapshots?.closest;

    if (!snapshot?.available) {
      return `No Wayback Machine snapshots found for ${url}. The domain may have never been indexed or was very recently registered.`;
    }

    const ts = String(snapshot.timestamp ?? "");
    const year = ts.slice(0, 4);
    const month = ts.slice(4, 6);
    const day = ts.slice(6, 8);
    const snapshotDate = ts.length >= 8 ? `${year}-${month}-${day}` : ts;
    const status = snapshot.status ?? "unknown";
    const snapshotUrl = snapshot.url ?? "";

    const lines = [
      `## Wayback Check: ${url}`,
      `**Last snapshot:** ${snapshotDate} (HTTP ${status})`,
      `**Snapshot URL:** ${snapshotUrl}`,
    ];

    const now = new Date();
    const snapshotAge = ts.length >= 8
      ? Math.round((now.getTime() - new Date(`${year}-${month}-${day}`).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    if (snapshotAge !== null) {
      if (snapshotAge > 365) {
        lines.push(`⚠️ **Signal:** Last snapshot was ${snapshotAge} days ago — domain may be defunct or inactive.`);
      } else {
        lines.push(`✅ **Signal:** Domain was active ${snapshotAge} days ago.`);
      }
    }

    return lines.join("\n");
  },
};
