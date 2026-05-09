"use client";

import { Activity } from "lucide-react";
import { RunDetail, type Run } from "@/components/activity/run-detail";

interface ActivityFeedProps {
  runs: Run[];
  isLoading?: boolean;
}

export function ActivityFeed({ runs, isLoading }: ActivityFeedProps) {
  if (!isLoading && runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Activity className="size-5 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-foreground">
          No activity yet
        </h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Agent runs will appear here as they are triggered. Run an agent to see
          its execution details.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline connector line */}
      <div className="absolute left-[1.3rem] top-0 bottom-0 w-px bg-border" />

      <div className="flex flex-col gap-2">
        {runs.map((run) => (
          <RunDetail key={run.id} run={run} />
        ))}
      </div>

      {isLoading && runs.length === 0 && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-[62px] animate-pulse rounded-lg border border-border bg-muted/30"
            />
          ))}
        </div>
      )}
    </div>
  );
}
