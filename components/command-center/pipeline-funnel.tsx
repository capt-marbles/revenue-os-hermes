"use client";

import { useEffect, useState } from "react";

interface FunnelStage {
  name: string;
  count: number;
  statuses: string[];
}

interface FunnelData {
  stages: FunnelStage[];
  totalActive: number;
  conversionRate: number;
  avgScore: number;
}

export function PipelineFunnel() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/command-center/funnel")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load funnel");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        Could not load pipeline funnel.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-1.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-16 rounded bg-muted/60 animate-pulse" />
            <div
              className="h-6 rounded-md bg-muted/40 animate-pulse"
              style={{ width: `${80 - i * 15}%` }}
            />
          </div>
        ))}
      </div>
    );
  }

  const maxCount = Math.max(...data.stages.map((s) => s.count), 1);

  return (
    <div>
      <div className="space-y-1">
        {data.stages.map((stage) => {
          const widthPct = Math.max((stage.count / maxCount) * 100, 3);
          const sharePct =
            data.totalActive > 0
              ? ((stage.count / data.totalActive) * 100).toFixed(0)
              : "0";

          return (
            <div key={stage.name} className="group flex items-center gap-3">
              <span className="w-[4.5rem] shrink-0 text-right text-[11px] font-medium text-muted-foreground truncate">
                {stage.name}
              </span>
              <div className="relative flex-1 h-6">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-foreground/8 dark:bg-foreground/6 transition-all duration-300 group-hover:bg-foreground/12"
                  style={{ width: `${widthPct}%` }}
                />
                <div className="relative flex h-full items-center gap-1.5 px-2">
                  <span className="text-xs font-semibold tabular-nums">{stage.count}</span>
                  {stage.count > 0 && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {sharePct}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Active
          </p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">{data.totalActive}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Conv.
          </p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {data.conversionRate.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Avg Score
          </p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {data.avgScore.toFixed(0)}
          </p>
        </div>
      </div>
    </div>
  );
}
