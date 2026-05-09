"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Clock, Zap, DollarSign, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface Run {
  id: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  taskId: string | null;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  trigger: string;
  input: string;
  output: string;
  error: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
  createdAt: string;
}

const statusConfig: Record<
  Run["status"],
  { label: string; variant: string; className: string }
> = {
  queued: {
    label: "Queued",
    variant: "secondary",
    className: "bg-secondary text-secondary-foreground",
  },
  running: {
    label: "Running",
    variant: "outline",
    className:
      "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 animate-pulse",
  },
  success: {
    label: "Success",
    variant: "outline",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    variant: "destructive",
    className: "",
  },
  cancelled: {
    label: "Cancelled",
    variant: "secondary",
    className: "bg-secondary text-secondary-foreground",
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function parseInputSummary(input: string): string {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === "string") return parsed;
    if (parsed.prompt) return parsed.prompt;
    if (parsed.message) return parsed.message;
    if (parsed.query) return parsed.query;
    if (parsed.task) return parsed.task;
    const str = JSON.stringify(parsed);
    return str.length > 120 ? str.slice(0, 120) + "..." : str;
  } catch {
    return input.length > 120 ? input.slice(0, 120) + "..." : input;
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

interface RunDetailProps {
  run: Run;
}

export function RunDetail({ run }: RunDetailProps) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[run.status];

  const timeAgo = formatDistanceToNow(new Date(run.createdAt), {
    addSuffix: true,
  });

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-border bg-card transition-all",
        "hover:border-foreground/15 hover:shadow-sm",
        expanded && "border-foreground/15 shadow-sm"
      )}
    >
      {/* Collapsed summary row */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
        aria-label={`${run.agentName} run - ${config.label}`}
      >
        {/* Timeline dot */}
        <div className="flex shrink-0 flex-col items-center self-stretch">
          <div
            className={cn(
              "mt-0.5 size-2.5 rounded-full ring-2 ring-background",
              run.status === "running" && "bg-yellow-500 animate-pulse",
              run.status === "success" && "bg-emerald-500",
              run.status === "failed" && "bg-destructive",
              run.status === "queued" && "bg-muted-foreground/40",
              run.status === "cancelled" && "bg-muted-foreground/40"
            )}
          />
        </div>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {run.agentName}
              </span>
              <Badge
                className={cn("shrink-0", config.className)}
              >
                {config.label}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {parseInputSummary(run.input)}
            </p>
          </div>

          {/* Meta info */}
          <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
            {run.durationMs > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatDuration(run.durationMs)}
              </span>
            )}
            <span className="whitespace-nowrap">{timeAgo}</span>
          </div>

          {/* Expand chevron */}
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        </div>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {/* Metadata row */}
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {run.durationMs > 0 ? formatDuration(run.durationMs) : "Pending"}
            </span>
            {run.tokensUsed > 0 && (
              <span className="flex items-center gap-1">
                <Zap className="size-3" />
                {run.tokensUsed.toLocaleString()} tokens
              </span>
            )}
            {run.costEstimate > 0 && (
              <span className="flex items-center gap-1">
                <DollarSign className="size-3" />$
                {run.costEstimate.toFixed(4)}
              </span>
            )}
            <span>
              Trigger: <span className="text-foreground">{run.trigger}</span>
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {run.id}
            </span>
          </div>

          {/* Error display */}
          {run.error && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <pre className="whitespace-pre-wrap break-all font-mono">
                {run.error}
              </pre>
            </div>
          )}

          {/* Input */}
          {run.input && (
            <div className="mb-3">
              <h4 className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Input
              </h4>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-3 text-xs font-mono text-foreground">
                {prettyJson(run.input)}
              </pre>
            </div>
          )}

          {/* Output */}
          {run.output && (
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Output
              </h4>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs font-mono text-foreground">
                {prettyJson(run.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
