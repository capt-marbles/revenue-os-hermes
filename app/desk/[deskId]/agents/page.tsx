"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/agents/agent-card";
import type { Agent } from "@/components/agents/agent-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Bot, Search, X, Plus, Check } from "lucide-react";

export default function DeskAgentsPage() {
  const { deskId } = useParams<{ deskId: string }>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  // Add skills dialog
  const [addOpen, setAddOpen] = useState(false);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);

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
          a.description?.toLowerCase().includes(q) ||
          a.slug.toLowerCase().includes(q)
      );
    }
    return result;
  }, [agents, search, sourceFilter]);

  const assignedIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  const filteredAll = useMemo(() => {
    if (!addSearch.trim()) return allAgents;
    const q = addSearch.toLowerCase();
    return allAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q)
    );
  }, [allAgents, addSearch]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/desks/${deskId}/agents`);
      if (!res.ok) throw new Error("Failed to load agents");
      const data = await res.json();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [deskId]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const openAddDialog = useCallback(async () => {
    setAddOpen(true);
    setAddSearch("");
    setAllLoading(true);
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to load agents");
      setAllAgents(await res.json());
    } catch {
      setAllAgents([]);
    } finally {
      setAllLoading(false);
    }
  }, []);

  const toggleAgent = useCallback(
    async (agentId: string, isAssigned: boolean) => {
      setToggling(agentId);
      try {
        const res = await fetch(`/api/desks/${deskId}/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: isAssigned ? "remove" : "add",
            agentId,
          }),
        });
        if (res.ok) {
          await fetchAgents();
        }
      } finally {
        setToggling(null);
      }
    },
    [deskId, fetchAgents]
  );

  return (
    <PageShell
      title="Skills"
      description="Skills assigned to this desk"
      actions={
        <Button variant="outline" size="sm" onClick={openAddDialog}>
          <Plus className="size-3.5" data-icon="inline-start" />
          Add Skills
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
              <p className="text-sm font-medium">No skills assigned</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add skills to this desk to get started.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openAddDialog}>
              <Plus className="size-3.5" data-icon="inline-start" />
              Add Skills
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
              {sources.length > 1 && (
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
                      onClick={() =>
                        setSourceFilter(sourceFilter === src ? null : src)
                      }
                    >
                      {src} ({count})
                    </Badge>
                  ))}
                </div>
              )}
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
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Skills dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Skills</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search all skills..."
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              autoFocus
            />
            {addSearch && (
              <button
                onClick={() => setAddSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 mt-1">
            {allLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : filteredAll.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {addSearch ? `No skills match "${addSearch}"` : "No skills available. Import skills first."}
              </p>
            ) : (
              <div className="space-y-1 py-1">
                {filteredAll.map((agent) => {
                  const isAssigned = assignedIds.has(agent.id);
                  const isToggling = toggling === agent.id;
                  return (
                    <button
                      key={agent.id}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                      onClick={() => toggleAgent(agent.id, isAssigned)}
                      disabled={isToggling}
                    >
                      <div className="flex size-6 shrink-0 items-center justify-center rounded bg-muted">
                        <Bot className="size-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{agent.name}</p>
                        {agent.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {agent.description}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {isToggling ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : isAssigned ? (
                          <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Plus className="size-4 text-muted-foreground/50" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
