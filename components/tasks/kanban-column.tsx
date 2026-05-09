"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { InboxIcon } from "lucide-react";
import { SortableTaskCard, type Task } from "@/components/tasks/task-card";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  id: string;
  label: string;
  tasks: Task[];
  onTaskUpdated?: () => void;
  onSelectTask?: (task: Task) => void;
  onDeleteTask?: (taskId: string) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
}

export function KanbanColumn({
  id,
  label,
  tasks,
  onTaskUpdated,
  onSelectTask,
  onDeleteTask,
  onApprove,
  onReject,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl lg:w-auto lg:min-w-0 lg:flex-1">
      <div className="flex h-9 items-center gap-2 px-1.5">
        <h3 className="text-[13px] font-semibold text-foreground">{label}</h3>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[120px] flex flex-1 flex-col gap-1.5 rounded-lg p-1.5 transition-colors",
            isOver ? "bg-muted/60 ring-1 ring-foreground/[0.04]" : "bg-muted/30",
          )}
        >
          {tasks.length === 0 && !isOver && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/50">
              <InboxIcon className="mb-1.5 size-5" />
              <span className="text-xs">No tasks</span>
            </div>
          )}
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onTaskUpdated={onTaskUpdated}
              onSelect={onSelectTask}
              onDelete={onDeleteTask}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
