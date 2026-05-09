"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Layers, Loader2, AlertTriangle, CheckCircle } from "lucide-react";

interface BatchDialogProps {
  agentId: string;
  agentName: string;
  onBatchStarted: () => void;
}

interface QueueStats {
  maxBatchSize: number;
  maxConcurrent: number;
  active: number;
  queued: number;
}

type DialogState =
  | { phase: "input" }
  | { phase: "submitting" }
  | { phase: "done"; count: number; stats: QueueStats };

export function BatchDialog({
  agentId,
  agentName,
  onBatchStarted,
}: BatchDialogProps) {
  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [state, setState] = useState<DialogState>({ phase: "input" });
  const [error, setError] = useState<string | null>(null);
  const [maxBatchSize, setMaxBatchSize] = useState<number>(0);

  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const inputCount = lines.length;
  const overLimit = maxBatchSize > 0 && inputCount > maxBatchSize;

  // Fetch queue config when dialog opens
  useEffect(() => {
    if (!open) return;
    fetch("/api/queue")
      .then((r) => r.json())
      .then((data: QueueStats) => setMaxBatchSize(data.maxBatchSize ?? 0))
      .catch(() => {});
  }, [open]);

  function resetDialog() {
    setRawText("");
    setState({ phase: "input" });
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetDialog();
  }

  const handleSubmit = useCallback(async () => {
    if (inputCount === 0 || overLimit) return;

    setState({ phase: "submitting" });
    setError(null);

    try {
      const res = await fetch(`/api/agents/${agentId}/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: lines }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      // Fetch updated queue stats for the confirmation screen
      const statsRes = await fetch("/api/queue");
      const stats: QueueStats = statsRes.ok
        ? await statsRes.json()
        : { maxBatchSize: 0, maxConcurrent: 3, active: 0, queued: 0 };

      setState({ phase: "done", count: inputCount, stats });
      onBatchStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState({ phase: "input" });
    }
  }, [agentId, lines, inputCount, overLimit, onBatchStarted]);

  const submitting = state.phase === "submitting";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Layers className="size-3.5" data-icon="inline-start" />
            Batch Run
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Batch Run {agentName}</DialogTitle>
          <DialogDescription>
            Run this agent with multiple inputs simultaneously. Enter one input
            per line.
          </DialogDescription>
        </DialogHeader>

        {state.phase === "done" ? (
          /* ---- Success screen ---- */
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  Batch queued: {state.count} runs
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  All inputs have been added to the processing queue.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span>
                Active:{" "}
                <span className="font-medium text-foreground">
                  {state.stats.active}
                </span>
              </span>
              <span>
                Queued:{" "}
                <span className="font-medium text-foreground">
                  {state.stats.queued}
                </span>
              </span>
            </div>

            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          /* ---- Input screen ---- */
          <>
            <div className="grid gap-2">
              <Label htmlFor="batch-input">Inputs</Label>
              <Textarea
                id="batch-input"
                placeholder={
                  "Enter one input per line, e.g.:\nresearch Acme Corp\nresearch Globex Inc\nresearch Initech"
                }
                className="min-h-36 resize-none font-mono text-[13px]"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                disabled={submitting}
              />

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Press {"\u2318"}+Enter to submit
                </p>
                {inputCount > 0 && (
                  <Badge
                    variant={overLimit ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >
                    {inputCount} input{inputCount !== 1 && "s"} detected
                  </Badge>
                )}
              </div>

              {overLimit && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <AlertTriangle className="size-3.5 shrink-0 text-destructive mt-0.5" />
                  <p className="text-xs text-destructive">
                    Batch limit is {maxBatchSize} inputs. Remove{" "}
                    {inputCount - maxBatchSize} input
                    {inputCount - maxBatchSize !== 1 && "s"} to continue.
                  </p>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || inputCount === 0 || overLimit}
              >
                {submitting ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Layers className="size-3.5" data-icon="inline-start" />
                )}
                {submitting
                  ? "Queuing..."
                  : `Run ${inputCount} Input${inputCount !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
