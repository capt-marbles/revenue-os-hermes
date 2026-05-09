"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BotIcon,
  CalendarIcon,
  GripVerticalIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskApproval } from "./task-approval";

export interface Task {
  id: string;
  tenantId: string;
  goalId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: "backlog" | "todo" | "in_progress" | "done" | "blocked";
  source: "manual" | "plan" | "trigger" | "policy" | "webhook";
  approvalMode: "none" | "before_run" | "before_send" | "before_close";
  approvalStatus: "pending" | "approved" | "rejected" | "redirected" | null;
  assigneeType: "human" | "agent" | "unassigned";
  assigneeId: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  position: number;
  depth: number;
  dueDate: string | null;
  tags: string;
  deskId: string | null;
  deskName: string | null;
  deskColor: string | null;
  createdAt: string;
  updatedAt: string;
}

const PRIORITY_BORDER: Record<Task["priority"], string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-blue-500",
  low: "border-l-border",
};

const PRIORITY_DOT: Record<Task["priority"], string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-blue-500",
  low: "bg-muted-foreground/40",
};

function formatDueDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isDueOverdue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

interface TaskCardProps {
  task: Task;
  isOverlay?: boolean;
  onTaskUpdated?: () => void;
  onSelect?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
}

export function TaskCard({
  task,
  isOverlay,
  onTaskUpdated,
  onSelect,
  onDelete,
}: TaskCardProps) {
  const assigneeLabel =
    task.assigneeType === "human"
      ? "Me"
      : task.assigneeType === "agent"
        ? task.assigneeId ?? "Agent"
        : null;

  return (
    <div
      onClick={() => onSelect?.(task)}
      className={cn(
        "group relative rounded-lg border-l-[3px] bg-card text-card-foreground ring-1 ring-foreground/[0.06] transition-shadow",
        PRIORITY_BORDER[task.priority],
        isOverlay
          ? "shadow-lg ring-foreground/10"
          : "cursor-pointer shadow-sm hover:shadow-md hover:ring-foreground/10",
      )}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-1">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {task.title}
          </p>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${task.title}"?`)) onDelete(task.id);
              }}
              className="shrink-0 rounded p-1 text-muted-foreground/0 group-hover:text-muted-foreground/60 hover:text-red-500 transition-colors"
              title="Delete task"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          )}
        </div>

        {task.approvalStatus === "pending" && (
          <div className="mt-1.5 inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            Approval: {task.approvalMode.replace("before_", "before ")}
          </div>
        )}

        {(assigneeLabel || task.dueDate || task.priority !== "low") && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            {task.priority !== "low" && (
              <span className="flex items-center gap-1 capitalize">
                <span
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    PRIORITY_DOT[task.priority],
                  )}
                />
                {task.priority}
              </span>
            )}

            {assigneeLabel && (
              <span className="flex items-center gap-1">
                {task.assigneeType === "agent" ? (
                  <BotIcon className="size-3 text-muted-foreground/70" />
                ) : (
                  <UserIcon className="size-3 text-muted-foreground/70" />
                )}
                {assigneeLabel}
              </span>
            )}

            {task.dueDate && (
              <span
                className={cn(
                  "ml-auto flex items-center gap-1",
                  isDueOverdue(task.dueDate) && task.status !== "done"
                    ? "text-red-500"
                    : "",
                )}
              >
                <CalendarIcon className="size-3" />
                {formatDueDate(task.dueDate)}
              </span>
            )}
          </div>
        )}

        {task.deskName && (
          <div className="mt-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: task.deskColor ? `${task.deskColor}22` : "rgba(100,100,100,0.1)",
                color: task.deskColor ?? "inherit",
              }}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: task.deskColor ?? "#888" }}
              />
              {task.deskName}
            </span>
          </div>
        )}

        {task.approvalStatus === "pending" && task.assigneeType === "agent" && (
          <TaskApproval
            taskId={task.id}
            approvalStatus={task.approvalStatus}
            assigneeType={task.assigneeType}
            onApproved={onTaskUpdated || (() => {})}
          />
        )}
      </div>
    </div>
  );
}

export function SortableTaskCard({
  task,
  onTaskUpdated,
  onSelect,
  onDelete,
  onApprove,
  onReject,
}: {
  task: Task;
  onTaskUpdated?: () => void;
  onSelect?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="group relative">
        <div
          {...listeners}
          className="absolute top-0 left-0 z-10 flex h-full w-5 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVerticalIcon className="size-3.5 text-muted-foreground/60" />
        </div>
        <TaskCard
          task={task}
          onTaskUpdated={onTaskUpdated}
          onSelect={onSelect}
          onDelete={onDelete}
          onApprove={onApprove}
          onReject={onReject}
        />
      </div>
    </div>
  );
}
