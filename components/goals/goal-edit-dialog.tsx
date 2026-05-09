"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2Icon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import type { Goal } from "./goal-card";

interface GoalEditDialogProps {
  goal: Goal;
  onSaved: () => void;
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "achieved", label: "Achieved" },
  { value: "archived", label: "Archived" },
] as const;

const UNIT_SUGGESTIONS = ["deals", "usd", "count", "position", "%", "leads"] as const;

export function GoalEditDialog({ goal, onSaved }: GoalEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state — initialize from goal
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description || "");
  const [status, setStatus] = useState<Goal["status"]>(goal.status);
  const [targetMetric, setTargetMetric] = useState(goal.targetMetric || "");
  const [targetValue, setTargetValue] = useState(
    goal.targetValue != null ? String(goal.targetValue) : ""
  );
  const [currentValue, setCurrentValue] = useState(
    goal.currentValue != null ? String(goal.currentValue) : ""
  );
  const [unit, setUnit] = useState(goal.unit || "");
  const [deadline, setDeadline] = useState(
    goal.deadline ? goal.deadline.split("T")[0] : ""
  );
  const [priority, setPriority] = useState(String(goal.priority));

  // Re-sync when goal prop changes (e.g. after another save)
  useEffect(() => {
    setTitle(goal.title);
    setDescription(goal.description || "");
    setStatus(goal.status);
    setTargetMetric(goal.targetMetric || "");
    setTargetValue(goal.targetValue != null ? String(goal.targetValue) : "");
    setCurrentValue(goal.currentValue != null ? String(goal.currentValue) : "");
    setUnit(goal.unit || "");
    setDeadline(goal.deadline ? goal.deadline.split("T")[0] : "");
    setPriority(String(goal.priority));
  }, [goal]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) return;

      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          title: title.trim(),
          status,
          priority: parseInt(priority, 10) || 0,
        };

        if (description.trim()) body.description = description.trim();
        if (description.trim() === "") body.description = null;

        if (targetMetric.trim()) body.targetMetric = targetMetric.trim();
        if (targetMetric.trim() === "") body.targetMetric = null;

        if (targetValue) body.targetValue = Number(targetValue);
        if (targetValue === "") body.targetValue = null;

        if (currentValue) body.currentValue = Number(currentValue);
        if (currentValue === "") body.currentValue = 0;

        if (unit.trim()) body.unit = unit.trim();
        if (unit.trim() === "") body.unit = null;

        if (deadline) body.deadline = new Date(deadline).toISOString();
        if (!deadline) body.deadline = null;

        const res = await fetch(`/api/goals/${goal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error("Failed to save goal");

        toast.success("Goal updated");
        setOpen(false);
        onSaved();
      } catch (err) {
        console.error("Failed to save goal:", err);
        toast.error("Failed to save goal");
      } finally {
        setSubmitting(false);
      }
    },
    [title, description, status, targetMetric, targetValue, currentValue, unit, deadline, priority, goal.id, onSaved]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Trigger rendered as button on the card */}
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <PencilIcon className="size-3" />
          </Button>
        }
      />

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Goal</DialogTitle>
            <DialogDescription>
              Update the goal details, metric targets, and status.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            {/* Title */}
            <div className="grid gap-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="grid gap-1.5">
              <Label htmlFor="edit-desc">
                Description{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="edit-desc"
                placeholder="What does success look like?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Status + Priority row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => { if (v) setStatus(v as Goal["status"]); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-priority">Priority</Label>
                <Input
                  id="edit-priority"
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </div>
            </div>

            {/* Metric + Target + Current row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-metric">Metric</Label>
                <Input
                  id="edit-metric"
                  placeholder="e.g., deals_closed"
                  value={targetMetric}
                  onChange={(e) => setTargetMetric(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-target">Target</Label>
                <Input
                  id="edit-target"
                  type="number"
                  min={0}
                  placeholder="5"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-current">Current</Label>
                <Input
                  id="edit-current"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                />
              </div>
            </div>

            {/* Unit + Deadline row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-unit">Unit</Label>
                <Select value={unit} onValueChange={(v) => { if (v) setUnit(v); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="e.g., deals, usd" />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_SUGGESTIONS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                    {/* Custom unit entry */}
                    {!UNIT_SUGGESTIONS.includes(unit as any) && unit && (
                      <SelectItem value={unit}>{unit}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit-deadline">
                  Deadline{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="edit-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6 flex items-center justify-between">
            {/* Delete button */}
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={async () => {
                if (!confirm("Delete this goal and all its tasks?")) return;
                try {
                  const res = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
                  if (!res.ok) throw new Error();
                  toast.success("Goal deleted");
                  setOpen(false);
                  onSaved();
                } catch {
                  toast.error("Failed to delete goal");
                }
              }}
            >
              Delete
            </Button>

            {/* Save button */}
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting && <Loader2Icon className="animate-spin" />}
              {submitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
