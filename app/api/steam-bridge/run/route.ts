import { spawn } from "child_process";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { NextRequest } from "next/server";

const STEAM_BRIDGE_DIR = "/Volumes/projects/steam-bridge";
const SECRETS_FILE = `${process.env.HOME}/.hermes/secrets.env`;

function writeSecretsEnv(tmpPath: string): void {
  const lines: string[] = [];
  if (process.env.APOLLO_API_KEY) lines.push(`APOLLO_API_KEY=${process.env.APOLLO_API_KEY}`);
  if (process.env.HUNTER_API_KEY) lines.push(`HUNTER_API_KEY=${process.env.HUNTER_API_KEY}`);

  if (existsSync(SECRETS_FILE)) {
    for (const line of readFileSync(SECRETS_FILE, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const key = trimmed.split("=")[0];
      if (!lines.some((l) => l.startsWith(key + "="))) lines.push(trimmed);
    }
  }

  writeFileSync(tmpPath, lines.join("\n"));
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

function runProc(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd });
    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) onLine(line);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) onLine(`[stderr] ${line}`);
    });
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Process exited ${code}`))));
    proc.on("error", reject);
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("mode") ?? "scrape";
  const maxPages = Math.max(1, parseInt(searchParams.get("max_pages") ?? "3"));
  const limit = Math.max(1, parseInt(searchParams.get("limit") ?? "20"));

  if (!existsSync(STEAM_BRIDGE_DIR)) {
    return Response.json(
      { error: `Steam-Bridge not found at ${STEAM_BRIDGE_DIR}` },
      { status: 503 },
    );
  }

  const ts = Date.now();
  const gamesOut = join(tmpdir(), `sb_games_${ts}.csv`);
  const filteredCsv = join(tmpdir(), `sb_filtered_${ts}.csv`);
  const contactsOut = join(tmpdir(), `sb_contacts_${ts}.csv`);
  const secretsOut = join(tmpdir(), `sb_secrets_${ts}.env`);

  writeSecretsEnv(secretsOut);

  const enc = new TextEncoder();
  const sse = (event: string, data: unknown) =>
    enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        try {
          controller.enqueue(
            sse("log", `[steam-bridge] Scraping Steam (${maxPages} pages, PvP filter)…`),
          );

          await runProc(
            "python3",
            ["-m", "steam_scraper.main", "--output", gamesOut, "--max-pages", String(maxPages)],
            STEAM_BRIDGE_DIR,
            (line) => controller.enqueue(sse("log", line)),
          );

          if (!existsSync(gamesOut)) {
            controller.enqueue(sse("error", "Scraper produced no output file"));
            controller.close();
            return;
          }

          const allGames = parseCsv<Record<string, string>>(readFileSync(gamesOut, "utf-8"));
          const games = allGames.filter((g) =>
            String(g.modes ?? "")
              .split(",")
              .map((m) => m.trim())
              .includes("PvP"),
          );

          controller.enqueue(
            sse("log", `[steam-bridge] ${allGames.length} games scanned → ${games.length} PvP titles`),
          );

          if (mode === "scrape" || games.length === 0) {
            controller.enqueue(sse("result", { type: "games", games }));
            controller.enqueue(sse("done", "complete"));
            controller.close();
            return;
          }

          // Write filtered CSV for enricher
          const csvHeader =
            "app_id,title,developer,publisher,release_date,multiplayer_type,modes,steam_url";
          const csvRows = games.slice(0, limit).map((g) =>
            ["app_id", "title", "developer", "publisher", "release_date", "multiplayer_type", "modes", "steam_url"]
              .map((k) => `"${String(g[k] ?? "").replace(/"/g, '""')}"`)
              .join(","),
          );
          writeFileSync(filteredCsv, [csvHeader, ...csvRows].join("\n"));

          controller.enqueue(
            sse("log", `[steam-bridge] Enriching top ${Math.min(limit, games.length)} studios via Apollo + Hunter…`),
          );

          await runProc(
            "python3",
            [
              "enrich_contacts.py",
              "--input", filteredCsv,
              "--output", contactsOut,
              "--limit", String(limit),
              "--env", secretsOut,
            ],
            STEAM_BRIDGE_DIR,
            (line) => controller.enqueue(sse("log", line)),
          );

          if (!existsSync(contactsOut)) {
            controller.enqueue(sse("error", "Enricher produced no contacts file"));
            controller.close();
            return;
          }

          const contacts = parseCsv<Record<string, string>>(
            readFileSync(contactsOut, "utf-8"),
          );

          controller.enqueue(
            sse("log", `[steam-bridge] Done — ${contacts.length} contacts enriched`),
          );
          controller.enqueue(sse("result", { type: "contacts", contacts }));
          controller.enqueue(sse("done", "complete"));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(sse("error", msg));
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
