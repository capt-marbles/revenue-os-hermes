"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Run } from "@/components/activity/run-detail";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Queued" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const POLL_INTERVAL = 5000;

export default function ActivityPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setIsLoading(true);
      const res = await fetch("/api/runs?limit=100");
      if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
      const data: Run[] = await res.json();
      setRuns(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    fetchRuns(true);

    intervalRef.current = setInterval(() => {
      fetchRuns(false);
    }, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchRuns]);

  // Filtered runs
  const filteredRuns =
    filter === "all" ? runs : runs.filter((r) => r.status === filter);

  // Status counts for filter badges
  const counts = runs.reduce(
    (acc, run) => {
      acc[run.status] = (acc[run.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const runningCount = counts["running"] || 0;

  return (
    <PageShell
      title="Activity"
      description="Agent execution history and live status"
      actions={
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <Badge className="border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 animate-pulse">
              {runningCount} running
            </Badge>
          )}
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              Updated{" "}
              {lastUpdated.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => fetchRuns(false)}
            aria-label="Refresh activity feed"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      }
    >
      <div className="p-6">
        {/* Status filter tabs */}
        <div
          className="mb-5 flex items-center gap-1 rounded-lg bg-muted/50 p-1 w-fit"
          role="tablist"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((sf) => {
            const isActive = filter === sf.value;
            const count =
              sf.value === "all"
                ? runs.length
                : counts[sf.value] || 0;

            return (
              <button
                key={sf.value}
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(sf.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {sf.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 tabular-nums",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground/60"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Feed */}
        <ActivityFeed runs={filteredRuns} isLoading={isLoading} />
      </div>
    </PageShell>
  );
}
