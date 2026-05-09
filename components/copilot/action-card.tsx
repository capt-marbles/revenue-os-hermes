"use client";

import { useState } from "react";
import { AlertCircle, Check, Loader2, X, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getActionKey } from "@/lib/copilot/action-key";

interface ActionCardProps {
  conversationId: string;
  messageId: string;
  actionText: string;
  deskId?: string;
  persistedDecision?: {
    status: "approved" | "dismissed";
    resultMessage?: string | null;
  };
}

interface ParsedAction {
  title: string;
  type: string | null;
  details: Record<string, string>;
}

function parseAction(text: string): ParsedAction {
  const lines = text.split("\n");
  const title = lines[0]?.trim() || "Recommended Action";
  const details: Record<string, string> = {};
  let type: string | null = null;

  const contentIdx = lines.findIndex((l) => /^-?\s*Content:\s*$/i.test(l.trim()));
  let contentBlock = "";
  const detailLines = contentIdx >= 0 ? lines.slice(1, contentIdx) : lines.slice(1);

  if (contentIdx >= 0) {
    contentBlock = lines.slice(contentIdx + 1).join("\n").trim();
  }

  for (const line of detailLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.replace(/^-\s*/, "").match(/^(\w[\w\s]*?):\s*(.+)$/);
    if (!match) continue;

    const key = match[1].trim();
    // Strip backtick wrappers the LLM sometimes adds around values
    const value = match[2].trim().replace(/^`(.*)`$/, "$1");
    if (key.toLowerCase() === "type") {
      type = value;
    } else {
      details[key] = value;
    }
  }

  if (contentBlock) {
    details.Content = contentBlock;
  }

  return { title, type, details };
}

async function executeAction(
  action: ParsedAction,
  deskId?: string,
): Promise<{ success: boolean; message: string }> {
  const { type, details, title } = action;

  try {
    switch (type) {
      case "create_task": {
        const taskTitle = details.Title || details.title || title;
        const priority = details.Priority || details.priority || "medium";
        const description = details.Description || details.description || "";
        const goalName = details.Goal || details.goal || "";
        const approvalMode =
          details["Approval Mode"] ||
          details.approvalMode ||
          details.Approval ||
          "none";
        const source = details.Source || details.source || "manual";

        let goalId: string | undefined;
        if (goalName) {
          const goalsRes = await fetch("/api/goals");
          if (goalsRes.ok) {
            const goals = await goalsRes.json();
            const match = goals.find(
              (g: { id: string; title: string }) =>
                g.title.toLowerCase().includes(goalName.toLowerCase()) ||
                goalName.toLowerCase().includes(g.title.toLowerCase()),
            );
            if (match) goalId = match.id;
          }
        }

        const agentName = details.Agent || details.agent || "";
        let assigneeType = "unassigned";
        let assigneeId: string | undefined;

        if (agentName) {
          const agentsRes = await fetch("/api/agents");
          if (agentsRes.ok) {
            const agentsList = await agentsRes.json();
            const agentMatch = agentsList.find(
              (a: { id: string; name: string; slug: string }) =>
                a.name.toLowerCase().includes(agentName.toLowerCase()) ||
                a.slug.toLowerCase().includes(agentName.toLowerCase()),
            );
            if (agentMatch) {
              assigneeType = "agent";
              assigneeId = agentMatch.id;
            }
          }
        }

        const timeoutStr = details.Timeout || details.timeout || "";
        const timeoutSeconds = timeoutStr ? parseInt(timeoutStr, 10) : undefined;

        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: taskTitle,
            description,
            priority: priority.toLowerCase(),
            status: "todo",
            source: source.toLowerCase(),
            approvalMode: approvalMode.toLowerCase(),
            goalId,
            deskId,
            assigneeType,
            assigneeId,
            timeoutSeconds:
              timeoutSeconds && !Number.isNaN(timeoutSeconds)
                ? timeoutSeconds
                : undefined,
          }),
        });

        if (!res.ok) throw new Error("Failed to create task");
        const taskData = await res.json();

        if (assigneeType === "agent" && taskData.id) {
          await fetch(`/api/tasks/${taskData.id}/approve`, { method: "POST" });
          return {
            success: true,
            message: `Task created and executing: "${taskTitle}"`,
          };
        }

        const goalNote = goalId ? " (linked to goal)" : "";
        return { success: true, message: `Task created: "${taskTitle}"${goalNote}` };
      }

      case "update_goal": {
        // Fall back to action title when Goal field is absent (malformed block)
        const goalTitle = (details.Goal || details.goal || title || "").replace(/`/g, "").trim();
        console.log("[update_goal] looking for goal:", goalTitle, "details:", details);
        const goalsRes = await fetch("/api/goals");
        if (!goalsRes.ok) throw new Error("Failed to fetch goals");
        const goals = await goalsRes.json();
        console.log("[update_goal] available goals:", goals.map((g: { title: string }) => g.title));
        // 1. Exact substring match
        let match = goals.find(
          (g: { id: string; title: string }) =>
            g.title.toLowerCase().includes(goalTitle.toLowerCase()) ||
            goalTitle.toLowerCase().includes(g.title.toLowerCase()),
        );
        // 2. Word-overlap fallback — picks the goal sharing the most words with the query
        if (!match && goalTitle) {
          const queryWords = new Set(goalTitle.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
          let bestScore = 0;
          let bestGoal: (typeof goals)[number] | null = null;
          for (const g of goals as { id: string; title: string }[]) {
            const titleWords = g.title.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
            const overlap = titleWords.filter((w) => queryWords.has(w)).length;
            if (overlap > bestScore) { bestScore = overlap; bestGoal = g; }
          }
          if (bestScore > 0) match = bestGoal;
        }
        if (!match) {
          return {
            success: false,
            message: `Could not find goal matching "${goalTitle}". Available: ${goals.map((g: { title: string }) => g.title).join(", ")}`,
          };
        }

        const updates: Record<string, unknown> = {};
        const newTitle = details.Title || details.title || details["New Title"] || details.newTitle;
        if (newTitle) updates.title = newTitle;
        const description = details.Description || details.description;
        if (description !== undefined) updates.description = description;
        const currentVal = details["Current Value"] || details.currentValue;
        if (currentVal) updates.currentValue = parseFloat(currentVal);
        const targetVal = details["Target Value"] || details.targetValue;
        if (targetVal) updates.targetValue = parseFloat(targetVal);
        const targetMetric = details["Target Metric"] || details.targetMetric || details.Metric || details.metric;
        if (targetMetric) updates.targetMetric = targetMetric;
        const unit = details.Unit || details.unit;
        if (unit) updates.unit = unit;
        const deadline = details.Deadline || details.deadline;
        if (deadline) updates.deadline = deadline;
        const priority = details.Priority || details.priority;
        if (priority !== undefined) updates.priority = parseInt(String(priority), 10);
        const status = details.Status || details.status;
        if (status) updates.status = status.toLowerCase();

        console.log("[update_goal] match:", match.title, "updates:", updates);
        const res = await fetch(`/api/goals/${match.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const resBody = await res.json().catch(() => ({}));
        console.log("[update_goal] PATCH response:", res.status, resBody);
        if (!res.ok) throw new Error(`Failed to update goal: ${JSON.stringify(resBody)}`);
        if (typeof window !== "undefined") window.dispatchEvent(new Event("goal-updated"));
        const changed = Object.keys(updates).join(", ");
        return { success: true, message: `Goal "${match.title}" updated (${changed || "no fields changed"})` };
      }

      case "create_goal": {
        const goalTitle = details.Title || details.title || title;
        const description = details.Description || details.description || "";
        const priority = details.Priority || details.priority;
        const targetMetric = details["Target Metric"] || details.targetMetric || details.Metric || details.metric;
        const targetValue = details["Target Value"] || details.targetValue;
        const unit = details.Unit || details.unit;
        const deadline = details.Deadline || details.deadline;

        const body: Record<string, unknown> = {
          title: goalTitle,
          description,
          status: "active",
        };
        if (priority !== undefined) body.priority = parseInt(String(priority), 10);
        if (targetMetric) body.targetMetric = targetMetric;
        if (targetValue) body.targetValue = parseFloat(String(targetValue));
        if (unit) body.unit = unit;
        if (deadline) body.deadline = deadline;

        const res = await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to create goal");
        if (typeof window !== "undefined") window.dispatchEvent(new Event("goal-updated"));
        return { success: true, message: `Goal created: "${goalTitle}"` };
      }

      case "trigger_agent": {
        let agentName = details.Agent || details.agent || "";
        const rawDetails = details.Details || details.details || "";

        // CoS sometimes embeds the agent name in Details: "Re-run Steward on `...`"
        if (!agentName && rawDetails) {
          // Extract first capitalised word sequence before " on " or at the start
          const embedded = rawDetails.match(/^(?:Re-?run\s+)?([A-Z][A-Za-z\s]+?)(?:\s+on\b|$)/);
          if (embedded) agentName = embedded[1].trim();
        }

        const input =
          details.Input ||
          details.input ||
          details.Prompt ||
          details.prompt ||
          rawDetails ||
          title;

        if (!agentName) {
          return { success: false, message: "No agent name specified in trigger_agent action" };
        }

        const agentsRes = await fetch("/api/agents");
        if (!agentsRes.ok) throw new Error("Failed to fetch agents");
        const agentsList = await agentsRes.json();

        // Prefer exact name/slug match, then substring
        const agentNameLower = agentName.toLowerCase();
        const match =
          agentsList.find(
            (a: { id: string; name: string; slug: string }) =>
              a.name.toLowerCase() === agentNameLower ||
              a.slug.toLowerCase() === agentNameLower,
          ) ??
          agentsList.find(
            (a: { id: string; name: string; slug: string }) =>
              a.name.toLowerCase().includes(agentNameLower) ||
              a.slug.toLowerCase().includes(agentNameLower),
          );

        if (!match) {
          return {
            success: false,
            message: `Could not find agent matching "${agentName}"`,
          };
        }

        const res = await fetch(`/api/agents/${match.id}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input }),
        });
        if (!res.ok) throw new Error("Failed to trigger agent");
        return { success: true, message: `Agent "${match.name}" triggered` };
      }

      case "update_memory": {
        const category = details.Category || details.category || "custom";
        const key = details.Key || details.key || title.slice(0, 40);
        const value =
          details.Value ||
          details.value ||
          details.Content ||
          details.content ||
          "";

        const res = await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            layer: "global",
            scopeRefId: "",
            category,
            key,
            value,
            updatedBy: "chief_of_staff",
          }),
        });
        if (!res.ok) throw new Error("Failed to update memory");
        return { success: true, message: `Memory updated: ${category}/${key}` };
      }

      default:
        return { success: false, message: `Unknown action type: "${type}"` };
    }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Action failed",
    };
  }
}

export function ActionCard({
  conversationId,
  messageId,
  actionText,
  deskId,
  persistedDecision,
}: ActionCardProps) {
  const initialStatus =
    persistedDecision?.status === "approved"
      ? "approved"
      : persistedDecision?.status === "dismissed"
        ? "dismissed"
        : "pending";

  const [status, setStatus] = useState<
    "pending" | "executing" | "approved" | "failed" | "dismissed"
  >(initialStatus);
  const [resultMessage, setResultMessage] = useState<string | null>(
    persistedDecision?.resultMessage || null,
  );

  const { title, type, details } = parseAction(actionText);
  const actionKey = getActionKey(actionText);

  if (status === "dismissed") return null;

  async function persistDecision(
    nextStatus: "approved" | "dismissed",
    nextResultMessage?: string,
  ) {
    await fetch("/api/copilot/action-decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        messageId,
        actionKey,
        status: nextStatus,
        resultMessage: nextResultMessage,
      }),
    });
  }

  async function handleApprove() {
    setStatus("executing");
    // Persist immediately so tab-switch doesn't reset to "pending"
    await persistDecision("approved");
    const result = await executeAction({ title, type, details }, deskId);

    if (result.success) {
      setStatus("approved");
      setResultMessage(result.message);
      await persistDecision("approved", result.message);

      fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: type || "approve_action",
          entity:
            type === "create_task"
              ? "task"
              : type === "update_goal" || type === "create_goal"
                ? "goal"
                : type === "trigger_agent"
                  ? "agent"
                  : "memory",
          summary: `Co-Pilot action approved: ${result.message}`,
          source: "copilot",
          deskId,
        }),
      }).catch(() => {});
      return;
    }

    setStatus("failed");
    setResultMessage(result.message);
  }

  return (
    <Card
      className={cn(
        "my-2 border-emerald-500/20 bg-emerald-500/5",
        status === "approved" && "border-emerald-500/40 bg-emerald-500/10",
        status === "failed" && "border-red-500/20 bg-red-500/5",
      )}
    >
      <CardContent className="space-y-2 py-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-emerald-500/15">
            <Zap className="size-3 text-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">{title}</p>
            {type && (
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {type}
              </p>
            )}
            {Object.keys(details).length > 0 && (
              <div className="mt-1 space-y-0.5">
                {Object.entries(details).map(([key, value]) => (
                  <p key={key} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">{key}:</span>{" "}
                    {value}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {status === "pending" && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={handleApprove}
            >
              <Check className="size-3.5" data-icon="inline-start" />
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                setStatus("dismissed");
                await persistDecision("dismissed");
              }}
            >
              <X className="size-3.5" data-icon="inline-start" />
              Dismiss
            </Button>
          </div>
        )}

        {status === "executing" && (
          <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Executing...
          </div>
        )}

        {status === "approved" && (
          <div className="flex items-center gap-1.5 pt-1 text-xs font-medium text-emerald-600">
            <Check className="size-3.5" />
            {resultMessage || "Approved"}
          </div>
        )}

        {status === "failed" && (
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-500">
              <AlertCircle className="size-3.5" />
              {resultMessage || "Failed"}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus("pending")}
              className="text-xs"
            >
              Retry
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
