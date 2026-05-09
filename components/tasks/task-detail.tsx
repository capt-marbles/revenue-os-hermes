"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskApproval } from "./task-approval";
import type { Task } from "./task-card";
import {
  BotIcon,
  UserIcon,
  TargetIcon,
  ClockIcon,
  CalendarIcon,
  GitBranch,
  Trash2Icon,
  BuildingIcon,
  ChevronDownIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-500",
  high: "text-orange-500",
  medium: "text-blue-500",
  low: "text-muted-foreground",
};

const STATUS_BADGE: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-blue-500/10 text-blue-600",
  in_progress: "bg-amber-500/10 text-amber-600",
  done: "bg-emerald-500/10 text-emerald-600",
  blocked: "bg-red-500/10 text-red-600",
};

const APPROVAL_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending Approval", className: "bg-amber-500/10 text-amber-600" },
  approved: { label: "Approved", className: "bg-emerald-500/10 text-emerald-600" },
  rejected: { label: "Rejected", className: "bg-red-500/10 text-red-600" },
  redirected: { label: "Redirected", className: "bg-violet-500/10 text-violet-600" },
};

interface TaskDetailProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

interface ActivityEntry {
  type: "run" | "document" | "audit";
  id: string;
  title: string;
  status?: string;
  timestamp: string;
  detail?: string;
}

interface DeskOption {
  id: string;
  name: string;
  color: string | null;
}

interface TaskExtra {
  goalTitle?: string;
  parentTaskTitle?: string;
  subtasks?: Task[];
  agentName?: string;
  activity?: ActivityEntry[];
}

export function TaskDetail({ task, open, onClose, onUpdated }: TaskDetailProps) {
  const [extra, setExtra] = useState<TaskExtra>({});
  const [desks, setDesks] = useState<DeskOption[]>([]);
  const [reassigning, setReassigning] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  const fetchExtra = useCallback(async () => {
    if (!task) return;
    const data: TaskExtra = {};

    if (task.goalId) {
      try {
        const res = await fetch(`/api/goals/${task.goalId}`);
        if (res.ok) {
          const goal = await res.json();
          data.goalTitle = goal.title;
        }
      } catch {}
    }

    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const allTasks: Task[] = await res.json();
        data.subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
        if (task.parentTaskId) {
          const parent = allTasks.find((t) => t.id === task.parentTaskId);
          if (parent) data.parentTaskTitle = parent.title;
        }
      }
    } catch {}

    if (task.assigneeType === "agent" && task.assigneeId) {
      try {
        const res = await fetch(`/api/agents/${task.assigneeId}`);
        if (res.ok) {
          const agent = await res.json();
          data.agentName = agent.name;
        }
      } catch {}
    }

    // Fetch activity: agent runs, documents, and audit log entries for this task
    const activity: ActivityEntry[] = [];

    try {
      const runsRes = await fetch(`/api/runs?limit=20`);
      if (runsRes.ok) {
        const runs = await runsRes.json();
        for (const run of runs) {
          if (run.taskId === task.id) {
            activity.push({
              type: "run",
              id: run.id,
              title: `${run.agentName || "Agent"} — ${run.status}`,
              status: run.status,
              timestamp: run.createdAt,
              detail: run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : undefined,
            });
          }
        }
      }
    } catch {}

    try {
      const docsRes = await fetch(`/api/documents`);
      if (docsRes.ok) {
        const docs = await docsRes.json();
        for (const doc of docs) {
          if (doc.taskId === task.id) {
            activity.push({
              type: "document",
              id: doc.id,
              title: doc.title,
              timestamp: doc.createdAt,
              detail: doc.summary?.slice(0, 80),
            });
          }
        }
      }
    } catch {}

    try {
      const auditRes = await fetch(`/api/audit?limit=50`);
      if (auditRes.ok) {
        const entries = await auditRes.json();
        for (const entry of entries) {
          if (entry.entityId === task.id) {
            activity.push({
              type: "audit",
              id: entry.id,
              title: entry.summary,
              timestamp: entry.createdAt,
              detail: entry.source,
            });
          }
        }
      }
    } catch {}

    // Sort by timestamp descending
    activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    data.activity = activity;

    setExtra(data);
  }, [task]);

  useEffect(() => {
    if (open && task) {
      fetchExtra();
      fetch("/api/desks")
        .then((r) => r.ok ? r.json() : [])
        .then((data: DeskOption[]) => setDesks(data))
        .catch(() => {});
    }
  }, [open, task, fetchExtra]);

  async function reassignDesk(deskId: string | null) {
    if (!task) return;
    setReassigning(true);
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deskId }),
      });
      onUpdated();
    } finally {
      setReassigning(false);
    }
  }

  if (!task) return null;

  async function handleDelete() {
    if (!task) return;
    if (!confirm(`Delete "${task.title}"?`)) return;
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (res.ok) {
        onClose();
        onUpdated();
      }
    } catch {}
  }

  const statusBadge = STATUS_BADGE[task.status] || STATUS_BADGE.backlog;
  const approvalInfo = task.approvalStatus ? APPROVAL_BADGE[task.approvalStatus] : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[540px] sm:max-w-[60vw] p-0">
        <div className="flex h-full flex-col">
          {/* Header */}
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border space-y-3">
            <div className="flex items-start justify-between gap-2">
              <SheetTitle className="text-lg leading-snug">{task.title}</SheetTitle>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-red-500 shrink-0"
                onClick={handleDelete}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
            <SheetDescription className="sr-only">Task details</SheetDescription>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className={cn("text-[11px] capitalize", statusBadge)}>
                {task.status.replace("_", " ")}
              </Badge>
              <Badge variant="secondary" className={cn("text-[11px] capitalize", PRIORITY_COLOR[task.priority])}>
                {task.priority}
              </Badge>
              {approvalInfo && (
                <Badge variant="secondary" className={cn("text-[11px]", approvalInfo.className)}>
                  {approvalInfo.label}
                </Badge>
              )}
              {task.depth > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  Subtask (depth {task.depth})
                </Badge>
              )}
            </div>
          </SheetHeader>

          {/* Scrollable body */}
          <ScrollArea className="flex-1">
            <div className="px-6 py-5 space-y-6">

              {/* Description */}
              {task.description && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Description</h3>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {task.description}
                  </p>
                </section>
              )}

              <Separator />

              {/* Metadata grid */}
              <section className="grid grid-cols-2 gap-y-5 gap-x-6">
                <div>
                  <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Assigned to</h3>
                  <div className="flex items-center gap-2 text-sm">
                    {task.assigneeType === "agent" ? (
                      <>
                        <div className="flex size-6 items-center justify-center rounded-md bg-violet-500/10">
                          <BotIcon className="size-3.5 text-violet-500" />
                        </div>
                        <span className="font-medium">{extra.agentName || "Agent"}</span>
                      </>
                    ) : task.assigneeType === "human" ? (
                      <>
                        <div className="flex size-6 items-center justify-center rounded-md bg-blue-500/10">
                          <UserIcon className="size-3.5 text-blue-500" />
                        </div>
                        <span className="font-medium">Me</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Goal</h3>
                  <div className="flex items-center gap-2 text-sm">
                    {extra.goalTitle ? (
                      <>
                        <TargetIcon className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{extra.goalTitle}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Created</h3>
                  <div className="flex items-center gap-2 text-sm">
                    <ClockIcon className="size-3.5 text-muted-foreground" />
                    <span>{formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Due date</h3>
                  <div className="flex items-center gap-2 text-sm">
                    {task.dueDate ? (
                      <>
                        <CalendarIcon className="size-3.5 text-muted-foreground" />
                        <span>{new Date(task.dueDate).toLocaleDateString()}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </div>
                </div>

                <div className="col-span-2">
                  <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Desk</h3>
                  <div className="relative flex items-center gap-2">
                    {task.deskColor && (
                      <span
                        className="inline-block size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: task.deskColor }}
                      />
                    )}
                    {!task.deskColor && (
                      <BuildingIcon className="size-3.5 text-muted-foreground shrink-0" />
                    )}
                    <select
                      ref={selectRef}
                      defaultValue={task.deskId ?? ""}
                      disabled={reassigning || desks.length === 0}
                      onChange={(e) => reassignDesk(e.target.value || null)}
                      className="flex-1 appearance-none rounded border border-border bg-background px-2 py-1 pr-6 text-sm text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">Unassigned</option>
                      {desks.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              </section>

              {/* Parent task */}
              {extra.parentTaskTitle && (
                <>
                  <Separator />
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Parent task</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <GitBranch className="size-3.5 text-muted-foreground" />
                      <span>{extra.parentTaskTitle}</span>
                    </div>
                  </section>
                </>
              )}

              {/* Subtasks */}
              {extra.subtasks && extra.subtasks.length > 0 && (
                <>
                  <Separator />
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">
                      Subtasks ({extra.subtasks.length})
                    </h3>
                    <div className="space-y-2">
                      {extra.subtasks.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center gap-3 rounded-lg border border-border/50 px-4 py-3"
                        >
                          <Badge variant="secondary" className={cn("text-[10px] shrink-0 capitalize", STATUS_BADGE[sub.status])}>
                            {sub.status.replace("_", " ")}
                          </Badge>
                          <span className="text-sm truncate flex-1">{sub.title}</span>
                          {sub.assigneeType === "agent" && (
                            <BotIcon className="size-3.5 text-muted-foreground shrink-0" />
                          )}
                          {sub.approvalStatus === "pending" && sub.assigneeType === "agent" && (
                            <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-600 shrink-0">
                              Pending
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {/* Approval actions */}
              {task.approvalStatus === "pending" && task.assigneeType === "agent" && (
                <>
                  <Separator />
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">Actions</h3>
                    <TaskApproval
                      taskId={task.id}
                      approvalStatus={task.approvalStatus}
                      assigneeType={task.assigneeType}
                      onApproved={onUpdated}
                    />
                  </section>
                </>
              )}

              {/* Activity log */}
              {extra.activity && extra.activity.length > 0 && (
                <>
                  <Separator />
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">
                      Activity ({extra.activity.length})
                    </h3>
                    <div className="space-y-2">
                      {extra.activity.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-3 text-sm">
                          {/* Timeline dot */}
                          <div className="mt-1.5 flex flex-col items-center">
                            <div className={cn(
                              "size-2 rounded-full shrink-0",
                              entry.type === "run" && entry.status === "success" && "bg-emerald-500",
                              entry.type === "run" && entry.status === "failed" && "bg-red-500",
                              entry.type === "run" && entry.status === "running" && "bg-amber-500 animate-pulse",
                              entry.type === "run" && entry.status === "queued" && "bg-muted-foreground/40",
                              entry.type === "document" && "bg-blue-500",
                              entry.type === "audit" && "bg-violet-500",
                            )} />
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-snug">{entry.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                              <span>{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}</span>
                              {entry.detail && (
                                <>
                                  <span className="text-border">·</span>
                                  <span className="truncate">{entry.detail}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
