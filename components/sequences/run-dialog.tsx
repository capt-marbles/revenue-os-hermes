"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import type { Sequence } from "./sequence-card";

interface RunDialogProps {
  sequence: Sequence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRunStarted?: () => void;
}

interface RunProgress {
  id: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  stepName?: string;
}

export function RunDialog({
  sequence,
  open,
  onOpenChange,
  onRunStarted,
}: RunDialogProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Focus textarea when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      setInput("");
      setSubmitting(false);
      setProgress(null);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [open]);

  const pollRun = useCallback(
    (runId: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/sequence-runs/${runId}`);
          if (!res.ok) return;
          const data = await res.json();
          setProgress({
            id: data.id,
            status: data.status,
            currentStep: data.currentStep ?? 0,
            totalSteps: data.totalSteps ?? sequence?.stepCount ?? 0,
            stepName: data.currentStepName,
          });
          if (data.status === "completed" || data.status === "failed") {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            onRunStarted?.();
          }
        } catch {
          // Silently retry on next interval
        }
      }, 2000);
    },
    [sequence, onRunStarted]
  );

  const handleSubmit = useCallback(async () => {
    if (!sequence || !input.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });
      if (!res.ok) throw new Error("Failed to start run");
      const data = await res.json();
      setProgress({
        id: data.id,
        status: "running",
        currentStep: 0,
        totalSteps: sequence.stepCount,
      });
      pollRun(data.id);
      onRunStarted?.();
    } catch (err) {
      console.error("Failed to start sequence run:", err);
      toast.error("Failed to start sequence");
    } finally {
      setSubmitting(false);
    }
  }, [sequence, input, submitting, pollRun, onRunStarted]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  if (!sequence) return null;

  const percent =
    progress && progress.totalSteps > 0
      ? Math.round((progress.currentStep / progress.totalSteps) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run {sequence.name}</DialogTitle>
          <DialogDescription>
            Provide the initial input for this {sequence.stepCount}-step
            sequence.
          </DialogDescription>
        </DialogHeader>

        {!progress ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="run-input">Sequence Input</Label>
              <Textarea
                ref={textareaRef}
                id="run-input"
                rows={4}
                placeholder='e.g., "Find 10 game studio CTOs who are evaluating server hosting"'
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground/70">
                Press{" "}
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
                  Cmd+Enter
                </kbd>{" "}
                to run.
              </p>
            </div>

            <DialogFooter>
              <Button
                onClick={handleSubmit}
                disabled={!input.trim() || submitting}
              >
                {submitting ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Play className="size-3.5" data-icon="inline-start" />
                )}
                {submitting ? "Starting..." : "Run Sequence"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {progress.status === "running" && (
                    <Loader2 className="size-3.5 animate-spin text-amber-500" />
                  )}
                  {progress.status === "running"
                    ? `Running step ${progress.currentStep + 1} of ${progress.totalSteps}`
                    : progress.status === "completed"
                      ? "Sequence completed"
                      : "Sequence failed"}
                  {progress.stepName && progress.status === "running" && (
                    <span className="text-muted-foreground">
                      : {progress.stepName}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {percent}%
                </span>
              </div>
              <Progress value={percent} />
            </div>

            {progress.status === "completed" && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                All {progress.totalSteps} steps completed successfully.
              </p>
            )}
            {progress.status === "failed" && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Sequence failed at step {progress.currentStep + 1}.
              </p>
            )}

            {(progress.status === "completed" ||
              progress.status === "failed") && (
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </DialogFooter>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
