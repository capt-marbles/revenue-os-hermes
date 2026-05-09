"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { GoalCard, type Goal } from "@/components/goals/goal-card";
import { GoalForm } from "@/components/goals/goal-form";
import { Loader2Icon, TargetIcon } from "lucide-react";

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGoals = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/goals");
      if (!res.ok) throw new Error("Failed to load goals");
      const data = await res.json();
      setGoals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  // Re-fetch when the tab regains focus or when CoS modifies a goal
  useEffect(() => {
    const handleFocus = () => fetchGoals();
    const handleVisibility = () => { if (document.visibilityState === "visible") fetchGoals(); };
    const handleGoalUpdated = () => fetchGoals();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("goal-updated", handleGoalUpdated);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("goal-updated", handleGoalUpdated);
    };
  }, [fetchGoals]);

  // Sort: active first, then achieved, paused, archived. Within each group, by priority desc.
  const sortedGoals = [...goals].sort((a, b) => {
    const statusOrder: Record<Goal["status"], number> = {
      active: 0,
      paused: 1,
      achieved: 2,
      archived: 3,
    };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.priority - a.priority;
  });

  return (
    <PageShell
      title="Goals"
      description="Strategic objectives and measurable targets"
      actions={<GoalForm onCreated={fetchGoals} />}
    >
      {/* Loading state */}
      {loading && (
        <div className="flex flex-1 items-center justify-center p-12">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                fetchGoals();
              }}
              className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && goals.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
              <TargetIcon className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No goals yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create your first goal to start tracking strategic progress.
            </p>
          </div>
        </div>
      )}

      {/* Goals grid */}
      {!loading && !error && sortedGoals.length > 0 && (
        <div className="p-6">
          <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-2">
            {sortedGoals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} onTasksGenerated={fetchGoals} />
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
