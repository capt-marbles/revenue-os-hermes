"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { LiveActivity } from "@/components/tasks/live-activity";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskDetail } from "@/components/tasks/task-detail";
import type { Task } from "@/components/tasks/task-card";
import { Loader2Icon, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Desk {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  global: number;
}

export default function DeskTasksPage() {
  const { deskId } = useParams<{ deskId: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterToDesk, setFilterToDesk] = useState(false);
  const [isGlobalDesk, setIsGlobalDesk] = useState(false);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Check if current desk is global
  useEffect(() => {
    fetch("/api/desks")
      .then((r) => r.json())
      .then((data: Desk[]) => {
        setDesks(data);
        const current = data.find((d) => d.slug === deskId || d.id === deskId);
        if (current?.global) {
          setIsGlobalDesk(true);
        }
      })
      .catch(() => {});
  }, [deskId]);

  const fetchTasks = useCallback(async () => {
    try {
      const url = filterToDesk
        ? `/api/tasks?deskId=${deskId}`
        : "/api/tasks";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const data = await res.json();
      setTasks(data);
    } catch (err) {
      console.error("Failed to load tasks:", err);
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [deskId, filterToDesk]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  const handleMove = useCallback(
    async (taskId: string, status: string, position: number) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: status as Task["status"], position }
            : t
        )
      );

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, position }),
        });

        if (!res.ok) {
          fetchTasks();
        }
      } catch {
        fetchTasks();
      }
    },
    [fetchTasks]
  );

  const handleDelete = useCallback(async (taskId: string) => {
    try {
      await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setSelectedTask(null);
    } catch {}
  }, []);

  return (
    <PageShell
      title="Tasks"
      description="Manage work across your team and agents"
      actions={
        <div className="flex items-center gap-2">
          {/* Desk filter toggle — not shown for global desks (they always see all) */}
          {!isGlobalDesk && (
            <button
              onClick={() => setFilterToDesk(!filterToDesk)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                filterToDesk
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
              title={filterToDesk ? "Showing this desk only" : "Showing all desks"}
            >
              {filterToDesk ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {filterToDesk ? "This desk" : "All desks"}
            </button>
          )}
          <TaskForm onCreated={fetchTasks} deskId={deskId} />
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <LiveActivity />
          <KanbanBoard
          tasks={tasks}
          onMove={handleMove}
          onTaskUpdated={fetchTasks}
          onSelectTask={setSelectedTask}
          onDeleteTask={handleDelete}
        />
        </>
      )}

      <TaskDetail
        task={selectedTask}
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdated={() => { setSelectedTask(null); fetchTasks(); }}
      />
    </PageShell>
  );
}
