"use client";

import { useState } from "react";
import { formatDistanceToNow, format, differenceInDays } from "date-fns";
import {
  CalendarIcon,
  CheckCircle2Icon,
  PauseIcon,
  ArchiveIcon,
  TargetIcon,
  ListTodo,
  Loader2,
  Check,
} from "lucide-react";
import { GoalEditDialog } from "./goal-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Goal {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: "active" | "achieved" | "paused" | "archived";
  targetMetric: string | null;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  deadline: string | null;
  priority: number;
  approvalMode: string | null;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  tasksDone: number;
}

// ---------- Metric formatting ----------

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatMetricLabel(goal: Goal): string {
  const current = goal.currentValue ?? 0;
  const target = goal.targetValue;
  const unit = goal.unit?.toLowerCase() ?? "";

  if (target == null) return "";

  if (unit === "usd") {
    return `${formatCurrency(current)} / ${formatCurrency(target)}`;
  }

  if (unit === "position") {
    const currentDisplay = current === 0 ? "\u2014" : String(current);
    return `Position: ${currentDisplay} / ${target}`;
  }

  if (unit === "deals" || unit === "count") {
    return `${current} / ${target} ${unit === "count" ? "" : unit}`.trim();
  }

  return `${current} / ${target}`;
}

// ---------- Status badge config ----------

const STATUS_CONFIG: Record<
  Goal["status"],
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  active: {
    label: "Active",
    className:
      "border-success/40 text-success bg-transparent",
    icon: TargetIcon,
  },
  achieved: {
    label: "Achieved",
    className:
      "border-transparent bg-success/15 text-success",
    icon: CheckCircle2Icon,
  },
  paused: {
    label: "Paused",
    className:
      "border-warning/40 text-warning bg-transparent",
    icon: PauseIcon,
  },
  archived: {
    label: "Archived",
    className:
      "border-border text-muted-foreground bg-transparent",
    icon: ArchiveIcon,
  },
};

// ---------- Deadline formatting ----------

function formatDeadline(iso: string): string {
  const target = new Date(iso);
  const now = new Date();
  const days = differenceInDays(target, now);

  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  if (days <= 90) return `${days} day${days === 1 ? "" : "s"} left`;

  return format(target, "MMM d, yyyy");
}

function isOverdue(iso: string): boolean {
  return differenceInDays(new Date(iso), new Date()) < 0;
}

// ---------- Component ----------

interface GoalCardProps {
  goal: Goal;
  onTasksGenerated?: () => void;
  onGoalSaved?: () => void;
}

export function GoalCard({ goal, onTasksGenerated, onGoalSaved }: GoalCardProps) {
  const [decomposing, setDecomposing] = useState(false);
  const [decomposed, setDecomposed] = useState<string | null>(null);

  async function handleDecompose() {
    setDecomposing(true);
    setDecomposed(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}/decompose`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate tasks");
      const data = await res.json();
      setDecomposed(`${data.count} tasks created`);
      onTasksGenerated?.();
    } catch {
      setDecomposed("Failed to generate tasks");
    } finally {
      setDecomposing(false);
    }
  }
  const statusConfig = STATUS_CONFIG[goal.status];
  const StatusIcon = statusConfig.icon;

  const progress =
    goal.targetValue && goal.targetValue > 0
      ? Math.min(
          100,
          Math.round(((goal.currentValue ?? 0) / goal.targetValue) * 100)
        )
      : 0;

  const metricLabel = formatMetricLabel(goal);

  const taskProgress =
    goal.taskCount > 0
      ? Math.round((goal.tasksDone / goal.taskCount) * 100)
      : 0;

  return (
    <div
      className={cn(
        "group relative rounded-xl bg-card text-card-foreground ring-1 ring-foreground/[0.06] transition-all",
        "shadow-sm hover:shadow-md hover:ring-foreground/10",
        goal.status === "archived" && "opacity-60"
      )}
    >
      <div className="px-5 pt-5 pb-4">
        {/* Header: title + status badge */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold leading-tight tracking-tight text-foreground">
            {goal.title}
          </h3>
          <div className="flex items-center gap-1.5">
            <GoalEditDialog goal={goal} onSaved={() => { onGoalSaved?.(); onTasksGenerated?.(); }} />
            <Badge
              className={cn("shrink-0 gap-1", statusConfig.className)}
            >
              <StatusIcon className="size-3" />
              {statusConfig.label}
            </Badge>
          </div>
        </div>

        {/* Description */}
        {goal.description && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">
            {goal.description}
          </p>
        )}

        {/* Metric progress */}
        {goal.targetValue != null && goal.targetValue > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted-foreground tabular-nums">
                {metricLabel}
              </span>
              <span className="text-xs font-medium tabular-nums text-foreground">
                {progress}%
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500 ease-out",
                  goal.status === "achieved"
                    ? "bg-success"
                    : progress >= 75
                      ? "bg-success"
                      : progress >= 40
                        ? "bg-blue-500"
                        : "bg-primary"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer: deadline + task progress + generate */}
      <div className="flex items-center gap-4 border-t border-border/50 px-5 py-3">
        {/* Deadline */}
        {goal.deadline && (
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              isOverdue(goal.deadline) && goal.status !== "achieved"
                ? "text-danger"
                : "text-muted-foreground"
            )}
          >
            <CalendarIcon className="size-3.5" />
            {formatDeadline(goal.deadline)}
          </span>
        )}

        {/* Task progress */}
        {goal.taskCount > 0 && (
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-muted-foreground tabular-nums">
              {goal.tasksDone} of {goal.taskCount} tasks done
            </span>
            <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/25 transition-all duration-500 ease-out"
                style={{ width: `${taskProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Goal actions */}
        {goal.status === "active" && (
          <div className="ml-auto flex items-center gap-2">
            {/* Approval mode toggle */}
            {goal.taskCount > 0 && goal.approvalMode !== "auto" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] h-7 text-warning hover:bg-warning/10"
                onClick={async () => {
                  try {
                    await fetch(`/api/goals/${goal.id}/approve-all`, { method: "POST" });
                    onTasksGenerated?.();
                  } catch {}
                }}
              >
                <Check className="size-3" data-icon="inline-start" />
                Always Approve
              </Button>
            )}
            {goal.approvalMode === "auto" && (
              <span className="flex items-center gap-1 text-[10px] text-warning">
                <Check className="size-3" />
                Auto
              </span>
            )}

            {decomposed ? (
              <span className="flex items-center gap-1 text-xs text-success">
                <Check className="size-3" />
                {decomposed}
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDecompose}
                disabled={decomposing}
                className="text-xs h-7"
              >
                {decomposing ? (
                  <Loader2 className="size-3 animate-spin" data-icon="inline-start" />
                ) : (
                  <ListTodo className="size-3" data-icon="inline-start" />
                )}
                {decomposing ? "Generating..." : "Generate Tasks"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
