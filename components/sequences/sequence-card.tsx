"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Workflow, Play, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  status: string;
  stepCount: number;
  lastRunStatus: string | null;
  runCount: number;
  createdAt: string;
}

const RUN_STATUS_STYLES: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  completed: {
    label: "Success",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
    dot: "bg-red-500",
  },
  running: {
    label: "Running",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500 animate-pulse",
  },
};

const NEVER_RAN = {
  label: "Never run",
  className: "bg-muted text-muted-foreground",
  dot: "bg-muted-foreground/60",
};

interface SequenceCardProps {
  sequence: Sequence;
  onRun: (sequence: Sequence) => void;
  onDelete: (id: string) => void;
  onClick: (sequence: Sequence) => void;
}

export function SequenceCard({
  sequence,
  onRun,
  onDelete,
  onClick,
}: SequenceCardProps) {
  const status = sequence.lastRunStatus
    ? RUN_STATUS_STYLES[sequence.lastRunStatus] ?? NEVER_RAN
    : NEVER_RAN;

  return (
    <Card
      className="group cursor-pointer transition-shadow hover:ring-foreground/20"
      onClick={() => onClick(sequence)}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Workflow className="size-4 text-muted-foreground" />
            </div>
            <CardTitle className="truncate">{sequence.name}</CardTitle>
          </div>
          <Badge variant="secondary" className={`shrink-0 ${status.className}`}>
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <CardDescription className="line-clamp-2 leading-relaxed">
          {sequence.description || "No description provided."}
        </CardDescription>
      </CardContent>

      <CardFooter className="gap-2">
        <Badge variant="secondary">
          {sequence.stepCount} {sequence.stepCount === 1 ? "step" : "steps"}
        </Badge>
        {sequence.runCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {sequence.runCount} {sequence.runCount === 1 ? "run" : "runs"}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(sequence.createdAt), {
            addSuffix: true,
          })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onRun(sequence);
            }}
            aria-label={`Run ${sequence.name}`}
          >
            <Play className="size-3.5" />
          </Button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(sequence.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            aria-label={`Delete ${sequence.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </CardFooter>
    </Card>
  );
}
