"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2 as Loader2Icon,
  Search as SearchIcon,
  BookOpen as BookOpenIcon,
  Plus as PlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WikiEntryCard,
  CATEGORIES,
  CATEGORY_LABELS,
  type WikiEntry,
} from "@/components/wiki/wiki-entry-card";
import { WikiForm } from "@/components/wiki/wiki-form";

export default function KnowledgePage() {
  const { deskId } = useParams<{ deskId: string }>();
  const [entries, setEntries] = useState<WikiEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`/api/wiki?deskId=${deskId}`);
      if (!res.ok) throw new Error("Failed to fetch wiki entries");
      const data = await res.json();
      setEntries(data);
    } catch (err) {
      console.error("Failed to load wiki entries:", err);
      toast.error("Failed to load wiki entries");
    } finally {
      setLoading(false);
    }
  }, [deskId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, WikiEntry[]>();
    for (const cat of CATEGORIES) {
      map.set(cat, []);
    }
    for (const entry of filtered) {
      const list = map.get(entry.category);
      if (list) {
        list.push(entry);
      }
    }
    return map;
  }, [filtered]);

  const handleSave = useCallback(
    async (id: string, data: { title: string; content: string }) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, title: data.title, content: data.content, updatedAt: new Date().toISOString() }
            : e
        )
      );

      try {
        const res = await fetch(`/api/wiki/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          fetchEntries();
        }
      } catch (err) {
        console.error("Failed to save wiki entry:", err);
        toast.error("Failed to save wiki entry");
        fetchEntries();
      }
    },
    [fetchEntries]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));

      try {
        const res = await fetch(`/api/wiki/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          fetchEntries();
        }
      } catch (err) {
        console.error("Failed to delete wiki entry:", err);
        toast.error("Failed to delete wiki entry");
        fetchEntries();
      }
    },
    [fetchEntries]
  );

  const handleCreate = useCallback(
    async (data: {
      deskId: string;
      title: string;
      category: string;
      content: string;
      tags: string[];
      confidence: string;
    }) => {
      try {
        const res = await fetch("/api/wiki", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to create entry");
        toast.success("Wiki entry created");
        await fetchEntries();
      } catch (err) {
        console.error("Failed to create wiki entry:", err);
        toast.error("Failed to create wiki entry");
      }
    },
    [fetchEntries]
  );

  return (
    <PageShell
      title="Director Knowledge"
      description="Structured knowledge the Director accumulates over time"
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="competitor" className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-2">
            <TabsList variant="line">
              {CATEGORIES.map((cat) => {
                const count = grouped.get(cat)?.length ?? 0;
                return (
                  <TabsTrigger key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                    {count > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1 h-4 min-w-4 px-1 text-[10px]"
                      >
                        {count}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search entries..."
                className="h-8 w-56 pl-8 text-sm"
                aria-label="Search wiki entries"
              />
            </div>
          </div>

          {CATEGORIES.map((cat) => {
            const catEntries = grouped.get(cat) ?? [];
            return (
              <TabsContent
                key={cat}
                value={cat}
                className="flex-1 overflow-auto p-6"
              >
                <div className="mx-auto max-w-3xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium text-muted-foreground">
                      {CATEGORY_LABELS[cat]} entries
                    </h2>
                    <WikiForm
                      category={cat}
                      deskId={deskId}
                      onSubmit={handleCreate}
                    />
                  </div>

                  {catEntries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
                      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <BookOpenIcon className="size-5 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium">
                        No {CATEGORY_LABELS[cat].toLowerCase()} yet
                      </p>
                      <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
                        Add your first entry so the Director has context about
                        your {CATEGORY_LABELS[cat].toLowerCase()}.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {catEntries.map((entry) => (
                        <WikiEntryCard
                          key={entry.id}
                          entry={entry}
                          onSave={handleSave}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </PageShell>
  );
}
