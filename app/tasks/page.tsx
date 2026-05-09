"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TaskForm } from "@/components/tasks/task-form";
import type { Task } from "@/components/tasks/task-card";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const data = await res.json();
      setTasks(data);
    } catch (err) {
      console.error("Failed to load tasks:", err);
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleDelete = useCallback(async (taskId: string) => {
    try {
      await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {}
  }, []);

  const handleMove = useCallback(async (taskId: string, status: string, position: number) => {
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: status as Task["status"], position } : t
        )
      );

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, position }),
        });

        if (!res.ok) {
          // Revert on failure
          fetchTasks();
        }
      } catch {
        fetchTasks();
      }
    },
    [fetchTasks]
  );

  const handleApprove = useCallback(
    async (taskId: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, approvalStatus: "approved", status: "todo" } : t
        )
      );

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalStatus: "approved", status: "todo" }),
        });
        if (!res.ok) fetchTasks();
      } catch {
        fetchTasks();
      }
    },
    [fetchTasks]
  );

  const handleReject = useCallback(
    async (taskId: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, approvalStatus: "approved", status: "blocked" } : t
        )
      );

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalStatus: "approved", status: "blocked" }),
        });
        if (!res.ok) fetchTasks();
      } catch {
        fetchTasks();
      }
    },
    [fetchTasks]
  );

  return (
    <PageShell
      title="Tasks"
      description="Manage work across your team and agents"
      actions={<TaskForm onCreated={fetchTasks} />}
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <KanbanBoard
          tasks={tasks}
          onMove={handleMove}
          onDeleteTask={handleDelete}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </PageShell>
  );
}
