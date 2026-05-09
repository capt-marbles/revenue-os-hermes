"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { MemoryEditor } from "@/components/memory/memory-editor";
import type { MemoryEntry } from "@/components/memory/memory-entry";

export default function MemoryPage() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/memory");
      if (!res.ok) throw new Error("Failed to fetch memory entries");
      const data = await res.json();
      setEntries(data);
    } catch (err) {
      console.error("Failed to load memory entries:", err);
      toast.error("Failed to load memory entries");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSyncBrand = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/memory/import-brand", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      if (data.errors?.length > 0) {
        toast.error(data.errors[0]);
      } else {
        toast.success(`Brand synced: ${data.created} new, ${data.updated} updated`);
      }
      await fetchEntries();
    } catch {
      toast.error("Failed to sync brand content");
    } finally {
      setSyncing(false);
    }
  }, [fetchEntries]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSave = useCallback(
    async (id: string, data: { key: string; value: string }) => {
      // Optimistic update
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, key: data.key, value: data.value, updatedAt: new Date().toISOString(), updatedBy: "human" }
            : e
        )
      );

      try {
        const res = await fetch(`/api/memory/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          fetchEntries();
        }
      } catch (err) {
        console.error("Failed to save memory entry:", err);
        toast.error("Failed to save memory entry");
        fetchEntries();
      }
    },
    [fetchEntries]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));

      try {
        const res = await fetch(`/api/memory/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          fetchEntries();
        }
      } catch (err) {
        console.error("Failed to delete memory entry:", err);
        toast.error("Failed to delete memory entry");
        fetchEntries();
      }
    },
    [fetchEntries]
  );

  const handleCreate = useCallback(
    async (data: { category: string; key: string; value: string }) => {
      try {
        const res = await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, updatedBy: "human" }),
        });
        if (!res.ok) throw new Error("Failed to create entry");
        await fetchEntries();
      } catch (err) {
        console.error("Failed to create memory entry:", err);
        toast.error("Failed to create memory entry");
      }
    },
    [fetchEntries]
  );

  return (
    <PageShell
      title="Shared Memory"
      description="ICP, brand voice, tools, and context for agents"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncBrand}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2Icon className="size-3.5 animate-spin" data-icon="inline-start" />
          ) : (
            <RefreshCwIcon className="size-3.5" data-icon="inline-start" />
          )}
          {syncing ? "Syncing..." : "Sync Brand"}
        </Button>
      }
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <MemoryEditor
          entries={entries}
          onSave={handleSave}
          onDelete={handleDelete}
          onCreate={handleCreate}
        />
      )}
    </PageShell>
  );
}
