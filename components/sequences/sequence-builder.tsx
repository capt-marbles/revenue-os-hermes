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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  ChevronUp,
  ChevronDown,
  X,
  Loader2,
  Bot,
} from "lucide-react";
import { toast } from "sonner";

interface Agent {
  id: string;
  name: string;
  slug: string;
  source: string;
  description: string;
}

interface StepDraft {
  key: string;
  name: string;
  agentId: string;
  promptTemplate: string;
  parallel: boolean;
}

function createStep(): StepDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    agentId: "",
    promptTemplate: "",
    parallel: false,
  };
}

/** Compute group numbers from the parallel flags. */
function computeGroups(steps: StepDraft[]): number[] {
  const groups: number[] = [];
  let currentGroup = 0;
  for (let i = 0; i < steps.length; i++) {
    if (i === 0 || !steps[i].parallel) {
      if (i > 0) currentGroup++;
      groups.push(currentGroup);
    } else {
      groups.push(currentGroup);
    }
  }
  return groups;
}

interface SequenceBuilderProps {
  onCreated: () => void;
}

export function SequenceBuilder({ onCreated }: SequenceBuilderProps) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([createStep()]);

  const groups = computeGroups(steps);

  useEffect(() => {
    if (!open) return;
    setLoadingAgents(true);
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => setAgents(data))
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
  }, [open]);

  function resetForm() {
    setName("");
    setDescription("");
    setSteps([createStep()]);
  }

  function updateStep(key: string, patch: Partial<StepDraft>) {
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s))
    );
  }

  function removeStep(key: string) {
    setSteps((prev) => {
      const next = prev.filter((s) => s.key !== key);
      // If the first step was removed, make sure the new first step is not parallel
      if (next.length > 0) {
        next[0] = { ...next[0], parallel: false };
      }
      return next;
    });
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      // First step can never be parallel
      if (next[0].parallel) {
        next[0] = { ...next[0], parallel: false };
      }
      return next;
    });
  }

  const canSave =
    name.trim() &&
    steps.length > 0 &&
    steps.every((s) => s.name.trim() && s.agentId && s.promptTemplate.trim());

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    const finalGroups = computeGroups(steps);
    try {
      const res = await fetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          steps: steps.map((s, i) => ({
            name: s.name.trim(),
            agentId: s.agentId,
            promptTemplate: s.promptTemplate,
            position: i,
            group: finalGroups[i],
          })),
        }),
      });
      if (!res.ok) throw new Error("Failed to create sequence");
      setOpen(false);
      resetForm();
      onCreated();
    } catch (err) {
      console.error("Failed to create sequence:", err);
      toast.error("Failed to create sequence");
    } finally {
      setSaving(false);
    }
  }, [canSave, name, description, steps, onCreated]);

  /** Check if a step is in a parallel group (group has more than one member). */
  function isInParallelGroup(index: number): boolean {
    const g = groups[index];
    return groups.filter((v) => v === g).length > 1;
  }

  /** Check if step is the first in its parallel group. */
  function isGroupStart(index: number): boolean {
    return index === 0 || groups[index] !== groups[index - 1];
  }

  /** Check if step is the last in its parallel group. */
  function isGroupEnd(index: number): boolean {
    return (
      index === steps.length - 1 || groups[index] !== groups[index + 1]
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-3.5" data-icon="inline-start" />
            New Sequence
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Sequence</DialogTitle>
          <DialogDescription>
            Chain agents together. Output from each step feeds into the next.
            Steps in the same group run in parallel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sequence info */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sequence-name">Name</Label>
              <Input
                id="sequence-name"
                placeholder="e.g., Prospecting Sequence"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sequence-desc">Description</Label>
              <Input
                id="sequence-desc"
                placeholder="What does this sequence do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          {/* Steps */}
          <div className="space-y-3">
            <Label>Steps</Label>

            <div className="space-y-0">
              {steps.map((step, index) => {
                const inParallel = isInParallelGroup(index);
                const groupStart = isGroupStart(index);
                const groupEnd = isGroupEnd(index);

                return (
                  <div key={step.key} className="relative">
                    {/* Parallel toggle for non-first steps */}
                    {index > 0 && (
                      <div className="flex items-center gap-2 py-1.5 pl-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none group">
                          <input
                            type="checkbox"
                            checked={step.parallel}
                            onChange={(e) =>
                              updateStep(step.key, {
                                parallel: e.target.checked,
                              })
                            }
                            className="size-3.5 rounded border-border accent-indigo-600"
                          />
                          <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                            Run alongside previous step
                          </span>
                        </label>
                      </div>
                    )}

                    {/* Step card with optional parallel indicator */}
                    <div className="flex">
                      {/* Parallel group bracket */}
                      {inParallel && (
                        <div className="relative w-3 shrink-0 mr-1.5">
                          <div
                            className={[
                              "absolute left-0 w-[3px] bg-indigo-500/70",
                              groupStart ? "top-0 rounded-t-full" : "top-0",
                              groupEnd
                                ? "bottom-0 rounded-b-full"
                                : "bottom-0",
                              !groupStart && !groupEnd
                                ? "inset-y-0"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{
                              top: groupStart ? "4px" : "0px",
                              bottom: groupEnd ? "4px" : "0px",
                            }}
                          />
                        </div>
                      )}

                      <div
                        className={[
                          "relative flex-1 rounded-lg border p-3 space-y-2.5 mb-2",
                          inParallel
                            ? "border-indigo-500/30 bg-indigo-500/[0.03]"
                            : "border-border",
                        ].join(" ")}
                      >
                        {/* Step header row */}
                        <div className="flex items-center gap-2">
                          <span
                            className={[
                              "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                              inParallel
                                ? "bg-indigo-600 text-white"
                                : "bg-primary text-primary-foreground",
                            ].join(" ")}
                          >
                            {index + 1}
                          </span>
                          <Input
                            placeholder="Step name, e.g., Find prospects"
                            value={step.name}
                            onChange={(e) =>
                              updateStep(step.key, { name: e.target.value })
                            }
                            className="h-8 text-sm flex-1"
                          />
                          {inParallel && groupStart && (
                            <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wider shrink-0">
                              Parallel
                            </span>
                          )}
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => moveStep(index, -1)}
                              disabled={index === 0}
                              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                              aria-label="Move step up"
                            >
                              <ChevronUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStep(index, 1)}
                              disabled={index === steps.length - 1}
                              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                              aria-label="Move step down"
                            >
                              <ChevronDown className="size-3.5" />
                            </button>
                            {steps.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeStep(step.key)}
                                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                aria-label="Remove step"
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Agent picker */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Agent
                          </Label>
                          {loadingAgents ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                              <Loader2 className="size-3 animate-spin" />
                              Loading agents...
                            </div>
                          ) : (
                            <Select
                              value={step.agentId}
                              onValueChange={(val) =>
                                updateStep(step.key, {
                                  agentId: val as string,
                                })
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select an agent" />
                              </SelectTrigger>
                              <SelectContent>
                                {agents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>
                                    <Bot className="size-3.5 text-muted-foreground" />
                                    {agent.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        {/* Prompt template */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Prompt Template
                          </Label>
                          <Textarea
                            rows={3}
                            placeholder="Enter the prompt for this step..."
                            value={step.promptTemplate}
                            onChange={(e) =>
                              updateStep(step.key, {
                                promptTemplate: e.target.value,
                              })
                            }
                            className="text-sm"
                          />
                          <p className="text-[11px] text-muted-foreground/70">
                            Use{" "}
                            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                              {"{{sequence_input}}"}
                            </code>{" "}
                            for the initial input,{" "}
                            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                              {"{{previous_output}}"}
                            </code>{" "}
                            for the previous step&apos;s output.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setSteps((prev) => [...prev, createStep()])}
            >
              <Plus className="size-3.5" data-icon="inline-start" />
              Add Step
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && (
              <Loader2
                className="size-3.5 animate-spin"
                data-icon="inline-start"
              />
            )}
            {saving ? "Creating..." : "Create Sequence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
