import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { RegisteredTool } from "./types";

const execAsync = promisify(exec);

const STEAM_BRIDGE_DIR = "/Volumes/projects/steam-bridge";
const SECRETS_FILE = `${process.env.HOME}/.hermes/secrets.env`;

interface SteamContact {
  name: string;
  title: string;
  company: string;
  email: string;
  email_locked: string;
  linkedin_url: string;
  domain: string;
  game_title: string;
  release_date: string;
  modes: string;
  steam_url: string;
  source: string;
}

interface GameRecord {
  app_id: string;
  title: string;
  developer: string;
  publisher: string;
  release_date: string;
  multiplayer_type: string;
  modes: string;
  steam_url: string;
}

function parseCsv<T>(content: string): T[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) ?? line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] ?? "").trim().replace(/^"|"$/g, "");
    });
    return obj as T;
  });
}

function writeSecretsEnv(tmpPath: string): void {
  const lines: string[] = [];
  const apolloKey = process.env.APOLLO_API_KEY;
  const hunterKey = process.env.HUNTER_API_KEY;
  if (apolloKey) lines.push(`APOLLO_API_KEY=${apolloKey}`);
  if (hunterKey) lines.push(`HUNTER_API_KEY=${hunterKey}`);

  // Also read from the hermes secrets file
  if (existsSync(SECRETS_FILE)) {
    const content = readFileSync(SECRETS_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const key = trimmed.split("=")[0];
      if (!lines.some((l) => l.startsWith(key + "="))) {
        lines.push(trimmed);
      }
    }
  }

  writeFileSync(tmpPath, lines.join("\n"));
}

export const scoutSteamBridge: RegisteredTool = {
  definition: {
    name: "steam_bridge",
    description: `Run the Steam-Bridge pipeline to find upcoming multiplayer game studios and their technical contacts.

Two modes:
- scrape: Find upcoming multiplayer games on Steam (fast, ~2-3 mins). Returns studios with game info.
- full: Scrape + enrich contacts via Apollo + Hunter (slower, ~10-20 mins). Returns people with emails/LinkedIn.

Use 'scrape' for a quick signal sweep. Use 'full' when you want contacts ready for Outreach to act on.

Results include: studio name, game title, release date, multiplayer type (PvP/PvE/MMO), developer contacts.
These are studios that are BUILDING multiplayer games right now — prime prospects before they lock in a hosting provider.`,
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["scrape", "full"],
          description: "scrape = games only (fast), full = games + contacts via Apollo/Hunter (slow)",
        },
        max_pages: {
          type: "number",
          description: "Max Steam search pages to scan (default 3, each page = 25 games). Use 10+ for thorough sweeps.",
        },
        limit: {
          type: "number",
          description: "For full mode: max studios to enrich with contact data (default 20, API credits cost money)",
        },
        filter_modes: {
          type: "array",
          items: { type: "string", enum: ["PvP", "PvE", "MMO"] },
          description: "Only return studios with these multiplayer modes (default: PvP — most relevant for Gameye)",
        },
      },
      required: ["mode"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    if (!existsSync(STEAM_BRIDGE_DIR)) {
      return `Steam-Bridge not found at ${STEAM_BRIDGE_DIR}. Ensure the project is mounted.`;
    }

    const mode = String(input.mode);
    const maxPages = Number(input.max_pages ?? 3);
    const limit = Number(input.limit ?? 20);
    const filterModes = Array.isArray(input.filter_modes)
      ? input.filter_modes.map(String)
      : ["PvP"];

    const tmpDir = tmpdir();
    const gamesOut = join(tmpDir, `steam_games_${Date.now()}.csv`);
    const contactsOut = join(tmpDir, `steam_contacts_${Date.now()}.csv`);
    const secretsOut = join(tmpDir, `steam_secrets_${Date.now()}.env`);

    writeSecretsEnv(secretsOut);

    // Step 1: Scrape Steam for upcoming multiplayer games
    try {
      const scrapeCmd = `cd "${STEAM_BRIDGE_DIR}" && python3 -m steam_scraper.main --output "${gamesOut}" --max-pages ${maxPages}`;
      await execAsync(scrapeCmd, { timeout: 5 * 60 * 1000 });
    } catch (err) {
      return `Steam scraper failed: ${(err as Error).message?.slice(0, 500)}`;
    }

    if (!existsSync(gamesOut)) return "Steam scraper ran but produced no output file.";

    const gamesRaw = parseCsv<GameRecord>(readFileSync(gamesOut, "utf-8"));

    // Filter by requested modes
    const games = gamesRaw.filter((g) => {
      if (filterModes.length === 0) return true;
      const gameModes = String(g.modes ?? "").split(",").map((m) => m.trim());
      return filterModes.some((f) => gameModes.includes(f));
    });

    if (games.length === 0) {
      return `Steam scraper found ${gamesRaw.length} multiplayer games but none matched mode filter: ${filterModes.join(", ")}`;
    }

    if (mode === "scrape") {
      const lines = games.slice(0, 30).map((g, i) => {
        const modes = g.modes || "unknown";
        const type = g.multiplayer_type || "?";
        return [
          `${i + 1}. **${g.title}** — ${g.developer}`,
          `   Release: ${g.release_date || "TBD"} · ${type} · ${modes}`,
          `   ${g.steam_url}`,
        ].join("\n");
      });

      return [
        `## Steam Pipeline Sweep (${games.length} ${filterModes.join("/")} games from ${gamesRaw.length} total)`,
        `Pages scanned: ${maxPages} (~${maxPages * 25} games checked)`,
        "",
        lines.join("\n\n"),
        games.length > 30 ? `\n…and ${games.length - 30} more.` : "",
        "",
        "Run with mode=full to enrich these studios with contacts via Apollo + Hunter.",
      ].filter((l) => l !== undefined).join("\n");
    }

    // Step 2: Full mode — run contact enrichment
    // Write a filtered CSV for the enricher
    const filteredCsvPath = join(tmpDir, `steam_filtered_${Date.now()}.csv`);
    const csvHeader = "app_id,title,developer,publisher,release_date,multiplayer_type,modes,steam_url";
    const csvRows = games.slice(0, limit).map((g) =>
      [g.app_id, g.title, g.developer, g.publisher, g.release_date, g.multiplayer_type, g.modes, g.steam_url]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    writeFileSync(filteredCsvPath, [csvHeader, ...csvRows].join("\n"));

    try {
      const enrichCmd = [
        `cd "${STEAM_BRIDGE_DIR}"`,
        `python3 enrich_contacts.py`,
        `--input "${filteredCsvPath}"`,
        `--output "${contactsOut}"`,
        `--limit ${limit}`,
        `--env "${secretsOut}"`,
      ].join(" && ");

      await execAsync(enrichCmd, { timeout: 25 * 60 * 1000 });
    } catch (err) {
      // Partial results may still exist
      const partialMsg = existsSync(contactsOut) ? " (partial results available)" : "";
      return `Contact enrichment failed${partialMsg}: ${(err as Error).message?.slice(0, 400)}`;
    }

    if (!existsSync(contactsOut)) return "Enricher ran but produced no contacts file.";

    const contacts = parseCsv<SteamContact>(readFileSync(contactsOut, "utf-8"));
    if (contacts.length === 0) return "Enricher ran but found no contacts.";

    const withEmail = contacts.filter((c) => c.email).length;
    const withLinkedin = contacts.filter((c) => c.linkedin_url).length;

    // Group by company for display
    const byCompany: Record<string, SteamContact[]> = {};
    for (const c of contacts) {
      const co = c.company || "Unknown";
      (byCompany[co] ??= []).push(c);
    }

    const lines = Object.entries(byCompany)
      .slice(0, 15)
      .map(([company, people], i) => {
        const game = people[0];
        const header = `${i + 1}. **${company}** — ${game.game_title} (${game.modes}, ${game.release_date || "TBD"})`;
        const contacts = people.map((p) => {
          const email = p.email ? ` · 📧 ${p.email}` : p.email_locked === "yes" ? " · 🔒 email locked" : "";
          const li = p.linkedin_url ? ` · 🔗 ${p.linkedin_url}` : "";
          return `   - ${p.name}${p.title ? ` (${p.title})` : ""}${email}${li}`;
        });
        return [header, ...contacts].join("\n");
      });

    return [
      `## Steam-Bridge Full Pipeline Results`,
      `${Object.keys(byCompany).length} studios · ${contacts.length} contacts · ${withEmail} with email · ${withLinkedin} with LinkedIn`,
      `Games scanned: ${gamesRaw.length} → filtered to ${games.length} ${filterModes.join("/")} → enriched top ${limit}`,
      "",
      lines.join("\n\n"),
      Object.keys(byCompany).length > 15 ? `\n…and ${Object.keys(byCompany).length - 15} more studios.` : "",
      "",
      "Use crm_create_deal to push validated targets into the pipeline.",
    ].join("\n");
  },
};
