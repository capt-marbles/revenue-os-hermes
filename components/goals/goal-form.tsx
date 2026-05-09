"use client";

import { useCallback, useState } from "react";
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
import { PlusIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

interface GoalFormProps {
  onCreated: () => void;
}

export function GoalForm({ onCreated }: GoalFormProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetMetric, setTargetMetric] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("");
  const [deadline, setDeadline] = useState("");

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    setTargetMetric("");
    setTargetValue("");
    setUnit("");
    setDeadline("");
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) return;

      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          title: title.trim(),
        };

        if (description.trim()) body.description = description.trim();
        if (targetMetric.trim()) body.targetMetric = targetMetric.trim();
        if (targetValue) body.targetValue = Number(targetValue);
        if (unit.trim()) body.unit = unit.trim();
        if (deadline) body.deadline = deadline;

        const res = await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error("Failed to create goal");

        reset();
        setOpen(false);
        onCreated();
      } catch (err) {
        console.error("Failed to create goal:", err);
        toast.error("Failed to create goal");
      } finally {
        setSubmitting(false);
      }
    },
    [title, description, targetMetric, targetValue, unit, deadline, onCreated, reset]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <PlusIcon data-icon="inline-start" />
            Add Goal
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Goal</DialogTitle>
            <DialogDescription>
              Define a strategic objective with measurable targets.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            {/* Title */}
            <div className="grid gap-1.5">
              <Label htmlFor="goal-title">Title</Label>
              <Input
                id="goal-title"
                placeholder="e.g., Close 5 enterprise deals this quarter"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="grid gap-1.5">
              <Label htmlFor="goal-desc">
                Description{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="goal-desc"
                placeholder="What does success look like?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Metric + Target row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="goal-metric">Target Metric</Label>
                <Input
                  id="goal-metric"
                  placeholder="e.g., deals_closed"
                  value={targetMetric}
                  onChange={(e) => setTargetMetric(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="goal-target">Target Value</Label>
                <Input
                  id="goal-target"
                  type="number"
                  min={0}
                  placeholder="e.g., 5"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                />
              </div>
            </div>

            {/* Unit + Deadline row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="goal-unit">Unit</Label>
                <Input
                  id="goal-unit"
                  placeholder="e.g., deals, usd, position"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="goal-deadline">
                  Deadline{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="goal-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting && <Loader2Icon className="animate-spin" />}
              {submitting ? "Creating..." : "Create Goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
