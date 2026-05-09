"use client";

import { useMemo } from "react";
import { DatabaseIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MemoryEntryCard, type MemoryEntry } from "./memory-entry";
import { MemoryForm } from "./memory-form";

const CATEGORIES = [
  "icp",
  "brand_voice",
  "competitors",
  "tools",
  "connectors",
  "custom",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  icp: "ICP",
  brand_voice: "Brand Voice",
  competitors: "Competitors",
  tools: "Tools",
  connectors: "Connectors",
  custom: "Custom",
};

interface MemoryEditorProps {
  entries: MemoryEntry[];
  onSave: (id: string, data: { key: string; value: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreate: (data: {
    category: string;
    key: string;
    value: string;
  }) => Promise<void>;
}

export function MemoryEditor({
  entries,
  onSave,
  onDelete,
  onCreate,
}: MemoryEditorProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, MemoryEntry[]>();
    for (const cat of CATEGORIES) {
      map.set(cat, []);
    }
    for (const entry of entries) {
      const list = map.get(entry.category);
      if (list) {
        list.push(entry);
      }
    }
    return map;
  }, [entries]);

  return (
    <Tabs defaultValue="icp" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-2">
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
                <MemoryForm category={cat} onSubmit={onCreate} />
              </div>

              {catEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <DatabaseIcon className="size-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">
                    No {CATEGORY_LABELS[cat]} entries yet
                  </p>
                  <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
                    Add your first entry so agents have context about your{" "}
                    {CATEGORY_LABELS[cat].toLowerCase()}.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {catEntries.map((entry) => (
                    <MemoryEntryCard
                      key={entry.id}
                      entry={entry}
                      onSave={onSave}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
