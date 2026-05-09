"use client";

import { useState, useRef, useEffect } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Loader2, CheckCircle2, AlertCircle, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface GameRow {
  app_id: string;
  title: string;
  developer: string;
  publisher: string;
  release_date: string;
  multiplayer_type: string;
  modes: string;
  steam_url: string;
}

interface ContactRow {
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
}

type RunMode = "scrape" | "full";

export default function SteamBridgePage() {
  const [mode, setMode] = useState<RunMode>("scrape");
  const [maxPages, setMaxPages] = useState(3);
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [pushed, setPushed] = useState<Set<string>>(new Set());
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Clean up SSE on unmount
  useEffect(() => () => esRef.current?.close(), []);

  function startRun() {
    if (running) return;
    setRunning(true);
    setLogs([]);
    setGames([]);
    setContacts([]);
    setPushed(new Set());
    setDuplicates(new Set());
    setError(null);
    setDone(false);

    const params = new URLSearchParams({
      mode,
      max_pages: String(maxPages),
      limit: String(limit),
    });

    const es = new EventSource(`/api/steam-bridge/run?${params}`);
    esRef.current = es;

    es.addEventListener("log", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as string;
      setLogs((prev) => [...prev, msg]);
    });

    es.addEventListener("result", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as
        | { type: "games"; games: GameRow[] }
        | { type: "contacts"; contacts: ContactRow[] };
      if (data.type === "games") setGames(data.games);
      else setContacts(data.contacts);
    });

    es.addEventListener("error", (e) => {
      const msg =
        "data" in e
          ? (JSON.parse((e as MessageEvent).data) as string)
          : "Stream connection error";
      setError(msg);
      setRunning(false);
      es.close();
    });

    es.addEventListener("done", () => {
      setDone(true);
      setRunning(false);
      es.close();
    });
  }

  function stopRun() {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    setLogs((prev) => [...prev, "[stopped by user]"]);
  }

  async function pushToCrm(key: string, body: Record<string, unknown>) {
    setPushing((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesMotion: "outbound", stage: "target_account", ...body }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.duplicate) {
          setDuplicates((prev) => new Set(prev).add(key));
        } else {
          setPushed((prev) => new Set(prev).add(key));
        }
      }
    } finally {
      setPushing((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <PageShell
      title="Steam Prospector"
      description="Find upcoming online PvP game studios for outbound outreach"
    >
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ToggleGroup
          value={[mode]}
          onValueChange={(v) => { if (v.length > 0 && !running) setMode(v[v.length - 1] as RunMode); }}
          disabled={running}
        >
          <ToggleGroupItem value="scrape">Scrape</ToggleGroupItem>
          <ToggleGroupItem value="full">Full + contacts</ToggleGroupItem>
        </ToggleGroup>

        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          PvP online only
        </span>

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Pages
          <input
            type="number"
            min={1}
            max={20}
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
            disabled={running}
            className="w-14 rounded border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          />
          <span className="text-xs">~{maxPages * 25} games</span>
        </label>

        {mode === "full" && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Enrich limit
            <input
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={running}
              className="w-14 rounded border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
            />
            <span className="text-xs">studios</span>
          </label>
        )}

        <div className="ml-auto">
          {running ? (
            <Button variant="destructive" size="sm" onClick={stopRun}>
              <Square className="mr-1.5 h-3 w-3" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={startRun}>
              <Play className="mr-1.5 h-3 w-3" />
              Run
            </Button>
          )}
        </div>
      </div>

      {/* Live log */}
      {(logs.length > 0 || running) && (
        <div
          ref={logRef}
          className="mb-4 h-48 overflow-y-auto rounded-md border border-border bg-black/85 p-3 font-mono text-xs text-green-400"
        >
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {running && <div className="animate-pulse">▌</div>}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Scrape results — games table */}
      {games.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              {games.length} PvP studios found
            </h2>
            <span className="text-xs text-muted-foreground">
              Check /crm before pushing to avoid duplicates
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Studio</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2">Release</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {games.map((g, i) => {
                  const key = `game-${g.app_id || i}`;
                  return (
                    <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{g.developer}</td>
                      <td className="px-3 py-2">
                        {g.steam_url ? (
                          <a
                            href={g.steam_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-500 hover:underline"
                          >
                            {g.title}
                          </a>
                        ) : (
                          g.title
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {g.release_date || "TBD"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{g.multiplayer_type}</td>
                      <td className="px-3 py-2 text-right">
                        {pushed.has(key) ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" /> Added
                          </span>
                        ) : duplicates.has(key) ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3" /> Already in CRM
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pushing.has(key)}
                            onClick={() =>
                              pushToCrm(key, {
                                name: `${g.developer} — Steam PvP`,
                                studioName: g.developer,
                                notes: [
                                  "Source: Steam-Bridge scrape",
                                  `Game: ${g.title}`,
                                  `Release: ${g.release_date || "TBD"}`,
                                  `Type: ${g.multiplayer_type}`,
                                  g.steam_url,
                                ]
                                  .filter(Boolean)
                                  .join("\n"),
                              })
                            }
                          >
                            {pushing.has(key) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Push to CRM"
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Full results — contacts table */}
      {contacts.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              {contacts.length} contacts enriched
            </h2>
            <span className="text-xs text-muted-foreground">
              Check /crm before pushing to avoid duplicates
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Studio</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">LinkedIn</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => {
                  const key = `contact-${c.email || c.name || i}`;
                  return (
                    <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{c.company}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.steam_url ? (
                          <a
                            href={c.steam_url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {c.game_title}
                          </a>
                        ) : (
                          c.game_title
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.name}
                        {c.title && (
                          <span className="ml-1 text-xs text-muted-foreground">({c.title})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="text-blue-500 hover:underline"
                          >
                            {c.email}
                          </a>
                        ) : c.email_locked === "yes" ? (
                          <span className="text-xs text-muted-foreground">locked</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.linkedin_url ? (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-500 hover:underline"
                          >
                            LinkedIn
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {pushed.has(key) ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" /> Added
                          </span>
                        ) : duplicates.has(key) ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3" /> Already in CRM
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pushing.has(key)}
                            onClick={() =>
                              pushToCrm(key, {
                                name: `${c.company} — Steam PvP`,
                                studioName: c.company,
                                contactName: c.name || undefined,
                                contactEmail: c.email || undefined,
                                notes: [
                                  "Source: Steam-Bridge full pipeline",
                                  `Game: ${c.game_title}`,
                                  `Release: ${c.release_date || "TBD"}`,
                                  `Modes: ${c.modes}`,
                                  c.steam_url,
                                ]
                                  .filter(Boolean)
                                  .join("\n"),
                              })
                            }
                          >
                            {pushing.has(key) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Push to CRM"
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {done && games.length === 0 && contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Run complete — no results matched the PvP filter.
        </p>
      )}
    </PageShell>
  );
}
