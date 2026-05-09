"use client";

import { useEffect, useState } from "react";
import { BotIcon } from "lucide-react";

interface ActiveRun {
  id: string;
  agentName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: string | null;
  createdAt: string;
}

function elapsed(iso: string | null): string {
  const from = iso ? new Date(iso) : null;
  if (!from) return "";
  const secs = Math.floor((Date.now() - from.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export function LiveActivity() {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;

    const poll = () => {
      fetch("/api/runs?status=running&limit=10")
        .then((r) => r.ok ? r.json() : [])
        .then((data: ActiveRun[]) => { if (active) setRuns(data); })
        .catch(() => {});
    };

    poll();
    const fetchInterval = setInterval(poll, 5000);
    // Tick every second to update elapsed display
    const tickInterval = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      active = false;
      clearInterval(fetchInterval);
      clearInterval(tickInterval);
    };
  }, []);

  if (runs.length === 0) return null;

  return (
    <div className="mx-6 mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
        Live
      </span>
      {runs.map((run) => (
        <div
          key={run.id}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] shadow-sm"
        >
          {/* Pulsing active dot */}
          <span className="relative flex size-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          <BotIcon className="size-3 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {run.agentName ?? "Agent"}
          </span>
          {run.taskTitle && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="max-w-[160px] truncate text-muted-foreground">
                {run.taskTitle}
              </span>
            </>
          )}
          {(run.startedAt || run.createdAt) && (
            <>
              <span className="text-muted-foreground/50">·</span>
              {/* tick dependency forces re-render each second */}
              <span className="tabular-nums text-muted-foreground" suppressHydrationWarning>
                {elapsed(run.startedAt ?? run.createdAt)}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
