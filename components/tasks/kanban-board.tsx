"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/tasks/kanban-column";
import { TaskCard, type Task } from "@/components/tasks/task-card";

const KANBAN_COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
] as const;

interface KanbanBoardProps {
  tasks: Task[];
  onMove: (taskId: string, status: string, position: number) => void;
  onTaskUpdated?: () => void;
  onSelectTask?: (task: Task) => void;
  onDeleteTask?: (taskId: string) => void;
  onApprove?: (taskId: string) => void;
  onReject?: (taskId: string) => void;
}

export function KanbanBoard({
  tasks,
  onMove,
  onTaskUpdated,
  onSelectTask,
  onDeleteTask,
  onApprove,
  onReject,
}: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const columns = useMemo(() => {
    const nextColumns: Record<string, Task[]> = {};
    for (const col of KANBAN_COLUMNS) {
      nextColumns[col.id] = [];
    }
    for (const task of tasks) {
      if (nextColumns[task.status]) {
        nextColumns[task.status].push(task);
      }
    }
    for (const key of Object.keys(nextColumns)) {
      nextColumns[key].sort((a, b) => a.position - b.position);
    }
    return nextColumns;
  }, [tasks]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      setActiveTask(task ?? null);
    },
    [tasks],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);

      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      let targetStatus: string;
      let targetTasks: Task[];

      const isColumn = KANBAN_COLUMNS.some((col) => col.id === over.id);
      if (isColumn) {
        targetStatus = over.id as string;
        targetTasks = columns[targetStatus].filter((t) => t.id !== taskId);
      } else {
        const overTask = tasks.find((t) => t.id === over.id);
        if (!overTask) return;
        targetStatus = overTask.status;
        targetTasks = columns[targetStatus].filter((t) => t.id !== taskId);
      }

      if (targetStatus === task.status && !isColumn && over.id === taskId) {
        return;
      }

      let newPosition: number;
      if (targetTasks.length === 0) {
        newPosition = 1000;
      } else if (isColumn) {
        newPosition = (targetTasks[targetTasks.length - 1]?.position ?? 0) + 1000;
      } else {
        const overIndex = targetTasks.findIndex((t) => t.id === over.id);
        if (overIndex <= 0) {
          newPosition = (targetTasks[0]?.position ?? 1000) / 2;
        } else {
          const before = targetTasks[overIndex - 1].position;
          const after = targetTasks[overIndex].position;
          newPosition = (before + after) / 2;
        }
      }

      onMove(taskId, targetStatus, newPosition);
    },
    [tasks, columns, onMove],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-3 p-4 lg:p-6">
        {KANBAN_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            label={col.label}
            tasks={columns[col.id]}
            onTaskUpdated={onTaskUpdated}
            onSelectTask={onSelectTask}
            onDeleteTask={onDeleteTask}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-72 rotate-[2deg] opacity-90">
            <TaskCard task={activeTask} isOverlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
