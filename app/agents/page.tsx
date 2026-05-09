"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AgentCard } from "@/components/agents/agent-card";
import type { Agent } from "@/components/agents/agent-card";
import { Download, Loader2, Bot, Search, X } from "lucide-react";

const STATUS_POLL_MS = 3000;
const DONE_FLASH_MS = 5000;

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  // live status overrides: agentId → "running" | "done" (idle falls back to agent.status)
  const [liveStatuses, setLiveStatuses] = useState<Record<string, string>>({});
  const prevStatusesRef = useRef<Record<string, string>>({});
  const doneTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const sources = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of agents) {
      counts[a.source] = (counts[a.source] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [agents]);

  const filtered = useMemo(() => {
    let result = agents;
    if (sourceFilter) {
      result = result.filter((a) => a.source === sourceFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.description?.toLowerCase().includes(q)) ||
          a.slug.toLowerCase().includes(q)
      );
    }
    return result;
  }, [agents, search, sourceFilter]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to load agents");
      const data = await res.json();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      // Optimistic removal
      setAgents((prev) => prev.filter((a) => a.id !== id));
      try {
        const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
        if (!res.ok) fetchAgents();
      } catch {
        fetchAgents();
      }
    },
    [fetchAgents]
  );

  const handleStop = useCallback(
    async (id: string) => {
      // Optimistic status update
      setLiveStatuses((prev) => ({ ...prev, [id]: "idle" }));
      try {
        await fetch(`/api/agents/${id}/stop`, { method: "POST" });
      } catch {
        // ignore — status poll will correct
      }
    },
    []
  );

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Poll for live status changes
  useEffect(() => {
    let active = true;

    async function pollStatus() {
      if (!active) return;
      try {
        const res = await fetch("/api/agents/status");
        if (!res.ok || !active) return;
        const data: { id: string; status: string }[] = await res.json();

        setLiveStatuses((prev) => {
          const next = { ...prev };
          for (const { id, status } of data) {
            const prevStatus = prevStatusesRef.current[id];
            if (prevStatus === "running" && status !== "running") {
              // Transition complete — show green for DONE_FLASH_MS
              next[id] = "done";
              clearTimeout(doneTimersRef.current[id]);
              doneTimersRef.current[id] = setTimeout(() => {
                setLiveStatuses((s) => {
                  const { [id]: _, ...rest } = s;
                  return rest;
                });
              }, DONE_FLASH_MS);
            } else if (status === "running") {
              next[id] = "running";
            } else if (next[id] !== "done") {
              delete next[id];
            }
          }
          prevStatusesRef.current = Object.fromEntries(data.map((d) => [d.id, d.status]));
          return next;
        });
      } catch {
        // silent — polling is best-effort
      }
    }

    const interval = setInterval(pollStatus, STATUS_POLL_MS);
    pollStatus();

    return () => {
      active = false;
      clearInterval(interval);
      for (const t of Object.values(doneTimersRef.current)) clearTimeout(t);
    };
  }, []);

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch("/api/agents/import", { method: "POST" });
      if (!res.ok) throw new Error("Import failed");
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <PageShell
      title="Skills"
      description="Manage the Chief of Staff and specialist skill workers"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleImport}
          disabled={importing}
        >
          {importing ? (
            <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" />
          ) : (
            <Download className="size-3.5" data-icon="inline-start" />
          )}
          {importing ? "Importing..." : "Import Agents"}
        </Button>
      }
    >
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchAgents}>
              Retry
            </Button>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Bot className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">No agents yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Import skills from your skill packs to get started.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
              <Download className="size-3.5" data-icon="inline-start" />
              Import Skills
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search + filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={sourceFilter === null ? "default" : "outline"}
                  className="cursor-pointer text-[11px]"
                  onClick={() => setSourceFilter(null)}
                >
                  All ({agents.length})
                </Badge>
                {sources.map(([src, count]) => (
                  <Badge
                    key={src}
                    variant={sourceFilter === src ? "default" : "outline"}
                    className="cursor-pointer text-[11px]"
                    onClick={() => setSourceFilter(sourceFilter === src ? null : src)}
                  >
                    {src} ({count})
                  </Badge>
                ))}
              </div>
            </div>

            {/* Results */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Search className="mb-2 size-5 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No agents match &ldquo;{search}&rdquo;
                  {sourceFilter && ` in ${sourceFilter}`}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={
                      liveStatuses[agent.id]
                        ? { ...agent, status: liveStatuses[agent.id] }
                        : agent
                    }
                    onDelete={handleDelete}
                    onStop={handleStop}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
