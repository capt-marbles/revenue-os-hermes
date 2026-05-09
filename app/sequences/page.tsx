"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { SequenceCard } from "@/components/sequences/sequence-card";
import type { Sequence } from "@/components/sequences/sequence-card";
import { SequenceBuilder } from "@/components/sequences/sequence-builder";
import { SequenceFlow } from "@/components/sequences/sequence-flow";
import type { SequenceStep, SequenceRun } from "@/components/sequences/sequence-flow";
import { RunDialog } from "@/components/sequences/run-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Workflow, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface SequenceDetail extends Sequence {
  steps: SequenceStep[];
  runs: SequenceRun[];
}

const RUN_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  completed: {
    label: "Success",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  running: {
    label: "Running",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SequenceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Run dialog
  const [runTarget, setRunTarget] = useState<Sequence | null>(null);

  const fetchSequences = useCallback(async () => {
    try {
      const res = await fetch("/api/sequences");
      if (!res.ok) throw new Error("Failed to load sequences");
      const data = await res.json();
      setSequences(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sequences");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/sequences/${id}`);
      if (!res.ok) throw new Error("Failed to load sequence");
      const data = await res.json();
      setDetail(data);
    } catch (err) {
      console.error("Failed to load sequence details:", err);
      toast.error("Failed to load sequence details");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      setSequences((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      try {
        const res = await fetch(`/api/sequences/${id}`, { method: "DELETE" });
        if (!res.ok) fetchSequences();
      } catch {
        fetchSequences();
      }
    },
    [fetchSequences, selectedId]
  );

  const handleClick = useCallback(
    (sequence: Sequence) => {
      if (selectedId === sequence.id) {
        setSelectedId(null);
        setDetail(null);
      } else {
        setSelectedId(sequence.id);
        fetchDetail(sequence.id);
      }
    },
    [selectedId, fetchDetail]
  );

  useEffect(() => {
    fetchSequences();
  }, [fetchSequences]);

  // Find active run for the flow diagram
  const activeRun = detail?.runs.find((r) => r.status === "running") ?? null;

  return (
    <PageShell
      title="Sequences"
      description="Chain agents together into multi-step workflows"
      actions={<SequenceBuilder onCreated={fetchSequences} />}
    >
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchSequences}>
              Retry
            </Button>
          </div>
        ) : sequences.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Workflow className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">No sequences yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a sequence to chain agents together into multi-step
                workflows.
              </p>
            </div>
            <SequenceBuilder onCreated={fetchSequences} />
          </div>
        ) : (
          <div className="flex gap-6">
            {/* Sequence list */}
            <div className="flex-1 min-w-0">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sequences.map((sequence) => (
                  <SequenceCard
                    key={sequence.id}
                    sequence={sequence}
                    onRun={(p) => setRunTarget(p)}
                    onDelete={handleDelete}
                    onClick={handleClick}
                  />
                ))}
              </div>
            </div>

            {/* Detail panel */}
            {selectedId && (
              <div className="w-80 shrink-0 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Sequence Detail</h2>
                  <button
                    onClick={() => {
                      setSelectedId(null);
                      setDetail(null);
                    }}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Close detail panel"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                {loadingDetail ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : detail ? (
                  <div className="space-y-4">
                    {/* Flow diagram */}
                    <SequenceFlow
                      steps={detail.steps}
                      activeRun={activeRun}
                    />

                    <Separator />

                    {/* Recent runs */}
                    <div className="space-y-2">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Recent Runs
                      </h3>
                      {detail.runs.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">
                          No runs yet.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {detail.runs.slice(0, 10).map((run) => {
                            const badge =
                              RUN_STATUS_BADGE[run.status] ??
                              RUN_STATUS_BADGE.running;
                            return (
                              <div
                                key={run.id}
                                className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Badge
                                    variant="secondary"
                                    className={badge.className}
                                  >
                                    {badge.label}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground truncate">
                                    {run.totalSteps} steps
                                  </span>
                                </div>
                                <span className="text-[11px] text-muted-foreground shrink-0">
                                  {formatDistanceToNow(
                                    new Date(run.startedAt),
                                    { addSuffix: true }
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-4">
                    Failed to load sequence details.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Run dialog */}
      <RunDialog
        sequence={runTarget}
        open={runTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRunTarget(null);
        }}
        onRunStarted={() => {
          fetchSequences();
          if (selectedId) fetchDetail(selectedId);
        }}
      />
    </PageShell>
  );
}
