"use client";

import { formatDistanceToNow } from "date-fns";
import {
  Target,
  BarChart3,
  Activity,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

interface Goal {
  id: string;
  title: string;
  status: string;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  deadline: string | null;
  taskCount: number;
  tasksDone: number;
  progress: number;
}

interface AgentPerformance {
  agentId: string;
  agentName: string;
  runs: number;
  successes: number;
  successRate: number;
  totalCost: number;
  avgDuration: number;
}

interface RecentRun {
  agentName: string;
  status: string;
  durationMs: number | null;
  costEstimate: number | null;
  taskTitle: string | null;
  createdAt: string;
}

interface BriefingData {
  structured: {
    goals: Goal[];
    taskDistribution: Record<string, number>;
    agentPerformance: AgentPerformance[];
    recentRuns: RecentRun[];
    memoryCategories: Array<{ category: string; count: number }>;
    totals: {
      totalRuns7d: number;
      successRate: number;
      totalCost: number;
      avgDuration: number;
    };
  };
}

interface RunRecord {
  id: string;
  agentName: string | null;
  agentSlug: string | null;
  taskTitle: string | null;
  status: string;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  costEstimate: number | null;
  createdAt: string;
}

interface BriefingSidebarProps {
  data: BriefingData | null;
  loading: boolean;
  onRefresh: () => void;
  lastUpdated: Date | null;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
      {children}
    </h3>
  );
}

function progressColor(pct: number): string {
  if (pct >= 75) return "bg-success";
  if (pct >= 40) return "bg-warning";
  return "bg-danger";
}

const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-zinc-300 dark:bg-zinc-600",
  todo: "bg-blue-400",
  in_progress: "bg-warning",
  done: "bg-success",
  cancelled: "bg-danger",
};

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

function RunStatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "mt-0.5 size-1.5 shrink-0 rounded-full",
        status === "success" ? "bg-success" :
        status === "running" ? "bg-warning animate-pulse" :
        (status === "error" || status === "failed") ? "bg-danger" : "bg-zinc-400"
      )}
    />
  );
}

function RunOutput({ output, error }: { output: string | null; error: string | null }) {
  let text = "";
  if (error) {
    text = error;
  } else if (output) {
    try {
      const parsed = JSON.parse(output);
      text = parsed.result ?? parsed.content ?? parsed.output ?? output;
    } catch {
      text = output;
    }
  }

  if (!text) return <p className="text-[11px] text-muted-foreground italic">No output recorded</p>;

  return (
    <div className="mt-2 max-h-64 overflow-y-auto rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words border border-border/50">
      {text}
    </div>
  );
}

function RunsTab() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs?limit=20");
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Poll while any run is active
  const hasActive = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(fetchRuns, 4000);
    return () => clearInterval(interval);
  }, [hasActive, fetchRuns]);

  // Refresh when a goal-updated or task-complete event fires
  useEffect(() => {
    const handler = () => setTimeout(fetchRuns, 1000);
    window.addEventListener("goal-updated", handler);
    return () => window.removeEventListener("goal-updated", handler);
  }, [fetchRuns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (runs.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No runs yet</p>;
  }

  return (
    <div className="space-y-1.5">
      {runs.map((run) => {
        const isOpen = expanded === run.id;
        const hasOutput = !!(run.output || run.error);
        return (
          <div
            key={run.id}
            className={cn(
              "rounded-lg border border-border/50 bg-muted/30 text-[11px]",
              run.status === "error" && "border-danger/30 bg-danger/5"
            )}
          >
            <button
              className="flex w-full items-start gap-2 p-2.5 text-left"
              onClick={() => hasOutput && setExpanded(isOpen ? null : run.id)}
            >
              <RunStatusDot status={run.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium leading-tight">
                  {run.agentName ?? "Agent"}
                </p>
                {run.taskTitle && (
                  <p className="truncate text-muted-foreground leading-tight mt-0.5">
                    {run.taskTitle}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                  <span>{formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}</span>
                  {run.durationMs != null && (
                    <span>· {(run.durationMs / 1000).toFixed(1)}s</span>
                  )}
                  {(run.status === "error" || run.status === "failed") && (
                    <span className="flex items-center gap-0.5 text-danger">
                      <AlertCircle className="size-2.5" /> failed
                    </span>
                  )}
                </div>
              </div>
              {hasOutput && (
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </span>
              )}
            </button>
            {isOpen && (
              <div className="border-t border-border/50 px-2.5 pb-2.5">
                <RunOutput output={run.output} error={run.error} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BriefingSidebar({
  data,
  loading,
  onRefresh,
  lastUpdated,
}: BriefingSidebarProps) {
  const s = data?.structured;
  const [tab, setTab] = useState<"context" | "runs">("context");

  return (
    <aside className="hidden w-80 shrink-0 border-l border-border lg:flex lg:flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-3 pt-2 pb-0">
        <div className="flex items-center gap-1">
          {(["context", "runs"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {t === "context" ? "Context" : "Runs"}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            {tab === "context" && lastUpdated && (
              <span className="text-[10px] text-muted-foreground/60">
                {formatDistanceToNow(lastUpdated, { addSuffix: true })}
              </span>
            )}
            {tab === "context" && (
              <Button variant="ghost" size="icon-xs" onClick={onRefresh} disabled={loading}>
                <RefreshCw className={cn("size-3", loading && "animate-spin")} />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {tab === "runs" ? (
          <RunsTab />
        ) : (
          <>
            {loading && !s && (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {s && (
              <>
                {/* Goals */}
                {s.goals.length > 0 && (
                  <section>
                    <SectionHeader>
                      <Target className="mr-1 inline size-3" />
                      Goals
                    </SectionHeader>
                    <div className="space-y-2">
                      {s.goals.map((g) => (
                        <div
                          key={g.id}
                          className="rounded-lg bg-muted/40 p-2.5 ring-1 ring-foreground/[0.04]"
                        >
                          <p className="text-xs font-medium leading-snug truncate">
                            {g.title}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1 flex-1 rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  progressColor(g.progress)
                                )}
                                style={{ width: `${Math.min(g.progress, 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {Math.round(g.progress)}%
                            </span>
                          </div>
                          {g.currentValue != null && g.targetValue != null && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {g.currentValue.toLocaleString()} / {g.targetValue.toLocaleString()}
                              {g.unit ? ` ${g.unit}` : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Task Distribution */}
                {Object.keys(s.taskDistribution).length > 0 && (
                  <section>
                    <SectionHeader>
                      <BarChart3 className="mr-1 inline size-3" />
                      Tasks
                    </SectionHeader>
                    <TaskBar distribution={s.taskDistribution} />
                  </section>
                )}

                {/* Agent Stats */}
                <section>
                  <SectionHeader>
                    <Activity className="mr-1 inline size-3" />
                    Agents (7d)
                  </SectionHeader>
                  <div className="grid grid-cols-3 gap-2">
                    <StatBox label="Runs" value={s.totals.totalRuns7d.toString()} />
                    <StatBox label="Success" value={`${Math.round(s.totals.successRate)}%`} />
                    <StatBox label="Cost" value={`$${s.totals.totalCost.toFixed(2)}`} />
                  </div>
                </section>

                {/* Recent Activity */}
                {s.recentRuns.length > 0 && (
                  <section>
                    <SectionHeader>
                      <Clock className="mr-1 inline size-3" />
                      Recent runs
                    </SectionHeader>
                    <div className="space-y-1.5">
                      {s.recentRuns.slice(0, 5).map((run, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              run.status === "success" ? "bg-success" :
                              run.status === "error" ? "bg-danger" : "bg-warning"
                            )}
                          />
                          <span className="truncate font-medium">{run.agentName}</span>
                          <span className="ml-auto shrink-0 text-muted-foreground">
                            {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function TaskBar({ distribution }: { distribution: Record<string, number> }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const entries = Object.entries(distribution).filter(([, v]) => v > 0);
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {entries.map(([status, count]) => (
          <div
            key={status}
            className={cn("h-full", STATUS_COLORS[status] || "bg-zinc-400")}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {entries.map(([status, count]) => (
          <div key={status} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", STATUS_COLORS[status] || "bg-zinc-400")} />
            {STATUS_LABELS[status] || status} ({count})
          </div>
        ))}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5 text-center ring-1 ring-foreground/[0.04]">
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
