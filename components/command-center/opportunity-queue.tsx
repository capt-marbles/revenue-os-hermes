"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CommandCenterData } from "@/lib/command-center/assemble";

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "bg-warning/10 text-warning"
      : tone === "success"
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

type QueueItem = CommandCenterData["queue"]["items"][number];
type SortField = "score" | "confidence" | "freshness" | "status";
type SortDir = "asc" | "desc";

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  }

  return data as T;
}

function StatusIcon({ status }: { status: string }) {
  if (["synced", "sent_cold", "won_intro"].includes(status)) {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />;
  }
  if (["drafted", "approved", "intro_candidate", "intro_requested", "intro_made"].includes(status)) {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />;
  }
  if (["queued", "scored", "discovered", "enriched", "active_followup"].includes(status)) {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />;
  }
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />;
}

function SortHeader({
  label,
  field,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {active && (
        <span className="text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>
      )}
    </button>
  );
}

export function OpportunityQueue({
  initialItems,
}: {
  initialItems: QueueItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"path" | "draft" | "sync" | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortDir("desc");
      }
      return field;
    });
  }, []);

  const sortedItems = [...items].sort((a, b) => {
    const dir = sortDir === "desc" ? -1 : 1;
    if (sortField === "score") return (a.score - b.score) * dir;
    if (sortField === "confidence") return (a.confidence - b.confidence) * dir;
    if (sortField === "freshness") {
      const aDate = a.freshestSignalAt ? new Date(a.freshestSignalAt).getTime() : 0;
      const bDate = b.freshestSignalAt ? new Date(b.freshestSignalAt).getTime() : 0;
      return (aDate - bDate) * dir;
    }
    if (sortField === "status") return a.status.localeCompare(b.status) * dir;
    return 0;
  });

  async function refreshQueueFromServer() {
    setIsRefreshing(true);
    try {
      const data = await fetch("/api/command-center", {
        method: "GET",
        cache: "no-store",
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "Failed to refresh command center");
        }
        return payload as CommandCenterData;
      });

      setItems(data.queue.items);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleSelectPath(itemId: string, path: "cold" | "warm") {
    const previousItems = items;
    setActiveItemId(itemId);
    setActiveAction("path");
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, recommendedPath: path, status: path === "warm" ? "intro_candidate" : "queued" }
          : item,
      ),
    );

    try {
      await postJson(`/api/opportunities/${itemId}/path-select`, { path });
      await refreshQueueFromServer();
      router.refresh();
      toast.success(path === "warm" ? "Warm intro path selected" : "Cold outreach path selected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to select path");
      setItems(previousItems);
    } finally {
      setActiveItemId(null);
      setActiveAction(null);
    }
  }

  async function handleCreateDraft(itemId: string, draftType: "cold_email" | "intro_request") {
    const previousItems = items;
    setActiveItemId(itemId);
    setActiveAction("draft");
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, draftStatus: "generated", status: "drafted" }
          : item,
      ),
    );

    try {
      await postJson<{ status: string; subject: string; modelRef: string }>(`/api/opportunities/${itemId}/draft`, {
        draftType,
        approvalMode: "pending",
      });
      await refreshQueueFromServer();
      router.refresh();
      toast.success(draftType === "intro_request" ? "Intro request drafted" : "Cold draft created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create draft");
      setItems(previousItems);
    } finally {
      setActiveItemId(null);
      setActiveAction(null);
    }
  }

  async function handleSync(itemId: string) {
    const previousItems = items;
    setActiveItemId(itemId);
    setActiveAction("sync");
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, syncStatus: "pending" }
          : item,
      ),
    );

    try {
      await postJson<{ status: string; externalRef?: string | null }>(`/api/opportunities/${itemId}/sync`, {
        targetSystem: "twenty",
        actionType: "create_contact",
        payloadSummary: "Synced from Command Center operator action",
      });
      await refreshQueueFromServer();
      router.refresh();
      toast.success("Synced to Twenty");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sync to Twenty");
      setItems(previousItems);
    } finally {
      setActiveItemId(null);
      setActiveAction(null);
    }
  }

  const sampleCount = items.filter((i) => i.isSample).length;
  const allSamples = sampleCount === items.length && items.length > 0;

  if (items.length === 0) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
        No queued opportunities yet. Keep it honest — let follow-ups and signal review fill the gap.
      </div>
    );
  }

  return (
    <div className="mt-2">
      {allSamples && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="font-medium">Demo mode</span>
          <span className="text-warning">— all {sampleCount} opportunities are sample data. Wire up real sources to see live pipeline.</span>
        </div>
      )}
      {isRefreshing && (
        <div className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Refreshing...
        </div>
      )}

      {/* Table header */}
      <div className="grid grid-cols-[2rem_1fr_140px_80px_80px_80px_100px_180px] items-center gap-2 border-b border-border pb-2 text-[11px]">
        <div />
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Opportunity</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Contact</span>
        <SortHeader label="Score" field="score" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Conf" field="confidence" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Path</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Actions</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {sortedItems.map((item) => {
          const isExpanded = expandedId === item.id;
          const isItemActive = activeItemId === item.id;
          const recommendedWarm = item.recommendedPath === "warm";

          return (
            <div key={item.id}>
              {/* Compact row */}
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedId(isExpanded ? null : item.id); }}
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                className={`grid w-full grid-cols-[2rem_1fr_140px_80px_80px_80px_100px_180px] items-center gap-2 py-2.5 text-left transition-colors hover:bg-muted/30 cursor-pointer ${
                  isItemActive ? "opacity-70" : ""
                }`}
              >
                <span className="flex items-center justify-center">
                  <StatusIcon status={item.status} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{item.title}</span>
                    {item.isSample && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                        Sample
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{item.accountName || "—"}</span>
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {item.primaryContactName || "—"}
                </span>
                <span className="text-sm font-semibold">{item.score}</span>
                <Badge tone={item.confidence >= 70 ? "success" : "warning"}>{item.confidence}%</Badge>
                <Badge>{item.status.replace(/_/g, " ")}</Badge>
                <Badge tone={recommendedWarm ? "success" : "default"}>
                  {recommendedWarm ? "Warm" : "Cold"}
                </Badge>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    disabled={isItemActive || isRefreshing}
                    onClick={() => startTransition(() => void handleCreateDraft(item.id, recommendedWarm ? "intro_request" : "cold_email"))}
                    className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent/40 disabled:opacity-50"
                  >
                    {isItemActive && activeAction === "draft" ? "..." : "Draft"}
                  </button>
                  <button
                    type="button"
                    disabled={isItemActive || isRefreshing}
                    onClick={() => startTransition(() => void handleSync(item.id))}
                    className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent/40 disabled:opacity-50"
                  >
                    {isItemActive && activeAction === "sync" ? "..." : "Sync"}
                  </button>
                  <span className="ml-1 text-[10px] text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="grid gap-4 px-4 pb-4 lg:grid-cols-[1fr_1fr]">
                  {/* Left: rationale + signals */}
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-background/60 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Why This Is Here
                      </p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {item.rationaleSummary || item.sourceSummary || "No rationale stored yet."}
                      </p>
                    </div>

                    {item.explainability.messaging.primaryAngle && (
                      <div className="rounded-xl border border-border bg-card px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Template Angle
                        </p>
                        <p className="mt-1 text-sm font-medium">{item.explainability.messaging.primaryAngle}</p>
                        {item.explainability.messaging.templateHint && (
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {item.explainability.messaging.templateHint}
                          </p>
                        )}
                      </div>
                    )}

                    {item.explainability.qualificationFacts.length > 0 && (
                      <div className="rounded-xl border border-border bg-background/60 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Qualification Facts
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {item.explainability.qualificationFacts.map((fact) => (
                            <div key={fact.label} className="flex items-start gap-3">
                              <span className="shrink-0 text-xs font-medium text-foreground w-24">{fact.label}</span>
                              <span className="text-xs text-muted-foreground">{fact.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.explainability.qualificationSignals.length > 0 && (
                      <div className="space-y-1.5">
                        {item.explainability.qualificationSignals.map((signal) => (
                          <div key={signal.label} className="rounded-lg bg-muted/40 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium">{signal.label}</span>
                              <Badge tone={signal.tone}>
                                {signal.tone === "success" ? "strong" : signal.tone === "warning" ? "watch" : "context"}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">{signal.detail}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right: path selection + intro signals + sources */}
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Path Selection
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          disabled={isItemActive || isRefreshing}
                          onClick={() => startTransition(() => void handleSelectPath(item.id, "cold"))}
                          className={`rounded-lg border px-3 py-2.5 text-left text-sm ${
                            !recommendedWarm
                              ? "border-foreground/20 bg-foreground text-background"
                              : "border-border bg-card"
                          } disabled:opacity-60`}
                        >
                          <span className="font-medium">Cold</span>
                          {!recommendedWarm && (
                            <Badge tone="success">Active</Badge>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isItemActive || isRefreshing}
                          onClick={() => startTransition(() => void handleSelectPath(item.id, "warm"))}
                          className={`rounded-lg border px-3 py-2.5 text-left text-sm ${
                            recommendedWarm
                              ? "border-foreground/20 bg-foreground text-background"
                              : "border-border bg-card"
                          } disabled:opacity-60`}
                        >
                          <span className="font-medium">Warm</span>
                          {recommendedWarm && (
                            <Badge tone="success">Active</Badge>
                          )}
                        </button>
                      </div>
                    </div>

                    {item.explainability.introPaths.length > 0 && (
                      <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Intro Paths
                        </p>
                        <div className="mt-2 space-y-2">
                          {item.explainability.introPaths.map((intro) => (
                            <div key={`${intro.connectorType}-${intro.pathSummary}`} className="rounded-lg bg-muted/40 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">
                                  {intro.mutualName ? `${intro.mutualName} via ${intro.connectorType}` : intro.connectorType}
                                </span>
                                <Badge tone={intro.confidence >= 70 ? "success" : "warning"}>{intro.confidence}%</Badge>
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">{intro.pathSummary}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.explainability.sources.length > 0 && (
                      <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Sources
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {item.explainability.sources.map((source) => (
                            <div key={`${source.sourceType}-${source.sourceRef}`} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-1.5">
                              <span className="text-xs font-medium">{source.sourceType}</span>
                              <Badge>{source.freshnessScore}%</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge>Draft: {item.draftStatus}</Badge>
                      <Badge>Sync: {item.syncStatus}</Badge>
                      {item.freshestSignalAt && <Badge>Fresh: {new Date(item.freshestSignalAt).toLocaleDateString()}</Badge>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
