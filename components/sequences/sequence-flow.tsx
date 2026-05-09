"use client";

import { Badge } from "@/components/ui/badge";
import { Bot, CheckCircle, XCircle, Loader2, ArrowDown, GitFork } from "lucide-react";
import { cn } from "@/lib/utils";

interface SequenceStep {
  id: string;
  sequenceId: string;
  agentId: string;
  position: number;
  group: number;
  name: string;
  promptTemplate: string;
  agentName: string;
  agentSlug: string;
}

interface SequenceRun {
  id: string;
  status: string;
  input: string;
  currentStep: number;
  totalSteps: number;
  startedAt: string;
  completedAt: string;
  error: string | null;
}

interface SequenceFlowProps {
  steps: SequenceStep[];
  activeRun?: SequenceRun | null;
}

function getStepState(
  stepIndex: number,
  activeRun?: SequenceRun | null
): "idle" | "completed" | "active" | "failed" {
  if (!activeRun) return "idle";

  const { status, currentStep } = activeRun;

  if (status === "completed") return "completed";
  if (status === "failed") {
    if (stepIndex < currentStep) return "completed";
    if (stepIndex === currentStep) return "failed";
    return "idle";
  }
  if (status === "running") {
    if (stepIndex < currentStep) return "completed";
    if (stepIndex === currentStep) return "active";
    return "idle";
  }
  return "idle";
}

const STATE_RING: Record<string, string> = {
  idle: "border-border",
  completed: "border-emerald-500/40 bg-emerald-500/5",
  active: "border-amber-500 ring-2 ring-amber-500/20 animate-pulse",
  failed: "border-red-500/40 bg-red-500/5",
};

export function SequenceFlow({ steps, activeRun }: SequenceFlowProps) {
  const sorted = [...steps].sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    return a.position - b.position;
  });

  // Group steps by group number
  const groups: SequenceStep[][] = [];
  let currentGroup: SequenceStep[] = [];
  let lastGroupNum = -1;

  for (const step of sorted) {
    if (step.group !== lastGroupNum) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [step];
      lastGroupNum = step.group;
    } else {
      currentGroup.push(step);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  let globalIndex = 0;

  return (
    <div className="flex flex-col items-center gap-0 py-2" role="list" aria-label="Sequence steps">
      {groups.map((group, groupIndex) => {
        const isParallel = group.length > 1;
        const startIndex = globalIndex;

        const groupEl = (
          <div key={`group-${groupIndex}`} className="flex flex-col items-center w-full max-w-lg">
            {/* Connector from previous group */}
            {groupIndex > 0 && (
              <div className="flex flex-col items-center py-1">
                <div className="h-4 w-px bg-border" />
                <ArrowDown className="size-3 text-muted-foreground/50" />
              </div>
            )}

            {isParallel ? (
              /* Parallel group — render steps side by side */
              <div className="w-full">
                {/* Fork indicator */}
                <div className="flex items-center justify-center gap-1 mb-2">
                  <GitFork className="size-3 text-indigo-500 rotate-180" />
                  <span className="text-[10px] font-medium text-indigo-500 uppercase tracking-wider">
                    Parallel
                  </span>
                </div>

                <div className="relative rounded-lg border-2 border-dashed border-indigo-500/20 bg-indigo-500/[0.02] p-2">
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(group.length, 3)}, 1fr)` }}>
                    {group.map((step) => {
                      const stepIdx = globalIndex++;
                      const state = getStepState(stepIdx, activeRun);

                      return (
                        <StepCard
                          key={step.id}
                          step={step}
                          index={stepIdx}
                          state={state}
                          compact={group.length > 2}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Sequential step */
              group.map((step) => {
                const stepIdx = globalIndex++;
                const state = getStepState(stepIdx, activeRun);

                return (
                  <StepCard
                    key={step.id}
                    step={step}
                    index={stepIdx}
                    state={state}
                    compact={false}
                  />
                );
              })
            )}
          </div>
        );

        return groupEl;
      })}
    </div>
  );
}

function StepCard({
  step,
  index,
  state,
  compact,
}: {
  step: SequenceStep;
  index: number;
  state: "idle" | "completed" | "active" | "failed";
  compact: boolean;
}) {
  return (
    <div
      role="listitem"
      className={cn(
        "w-full rounded-lg border p-3 transition-all",
        STATE_RING[state]
      )}
    >
      <div className="flex items-start gap-2">
        {/* Step number / status icon */}
        <div className="flex size-6 shrink-0 items-center justify-center">
          {state === "completed" ? (
            <CheckCircle className="size-4 text-emerald-500" />
          ) : state === "failed" ? (
            <XCircle className="size-4 text-red-500" />
          ) : state === "active" ? (
            <Loader2 className="size-4 text-amber-500 animate-spin" />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
              {index + 1}
            </span>
          )}
        </div>

        {/* Step content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className={cn("flex items-center gap-2", compact && "flex-col items-start gap-1")}>
            <span className="text-sm font-medium truncate">{step.name}</span>
            <Badge
              variant="secondary"
              className="shrink-0 bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px]"
            >
              <Bot className="size-2.5" />
              {step.agentName}
            </Badge>
          </div>
          {!compact && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {step.promptTemplate}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export type { SequenceStep, SequenceRun };
