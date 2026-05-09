"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Trash2, Clock } from "lucide-react";
import { describeCron } from "@/lib/scheduler/cron-utils";

export interface Schedule {
  id: string;
  name: string;
  description: string | null;
  type: "agent" | "sequence";
  targetId: string;
  targetName: string;
  input: string;
  cron: string;
  timezone: string;
  enabled: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ScheduleCardProps {
  schedule: Schedule;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ScheduleCard({ schedule, onToggle, onDelete }: ScheduleCardProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    onDelete(schedule.id);
  }, [onDelete, schedule.id]);

  return (
    <Card className="group">
      <CardContent className="flex items-center gap-4 py-4">
        {/* Icon */}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Clock className="size-4" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{schedule.name}</p>
            <Badge
              variant="secondary"
              className={
                schedule.type === "agent"
                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px]"
                  : "bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px]"
              }
            >
              {schedule.type === "agent" ? "Agent" : "Sequence"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {schedule.targetName} &middot; {describeCron(schedule.cron)}
          </p>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            <span>
              Last run: {schedule.lastRunAt ? formatRelativeTime(schedule.lastRunAt) : "Never"}
            </span>
            <span>&middot;</span>
            <span>{schedule.runCount} run{schedule.runCount !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon-xs"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
            aria-label={`Delete schedule ${schedule.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Switch
            size="sm"
            checked={schedule.enabled === 1}
            onCheckedChange={(checked) => onToggle(schedule.id, checked)}
            aria-label={`${schedule.enabled ? "Disable" : "Enable"} schedule ${schedule.name}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
