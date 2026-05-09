"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Cpu, Trash2, StopCircle } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  slug: string;
  agentType?: string;
  source: string;
  description: string;
  model: string;
  status: string;
  updatedAt: string;
}

const SOURCE_STYLES: Record<string, { label: string; className: string }> = {
  "marketing-skills": {
    label: "Marketing Skills",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  "agency-agents": {
    label: "Agency",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  custom: {
    label: "Custom",
    className: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
};

const STATUS_STYLES: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  idle: {
    label: "Idle",
    className: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
  running: {
    label: "Running",
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
    dot: "bg-red-500 animate-pulse",
  },
  done: {
    label: "Done",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  error: {
    label: "Error",
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
    dot: "bg-red-500",
  },
};

const AGENT_TYPE_STYLES: Record<string, { label: string; className: string }> = {
  chief_of_staff: {
    label: "Chief of Staff",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  specialist: {
    label: "Specialist",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
};

export function AgentCard({
  agent,
  onDelete,
  onStop,
}: {
  agent: Agent;
  onDelete?: (id: string) => void;
  onStop?: (id: string) => void;
}) {
  const router = useRouter();

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onDelete) return;
    onDelete(agent.id);
  }

  function handleStop(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onStop) return;
    onStop(agent.id);
  }

  const source = SOURCE_STYLES[agent.source] ?? {
    label: agent.source,
    className: "bg-muted text-muted-foreground",
  };

  const status = STATUS_STYLES[agent.status] ?? STATUS_STYLES.idle;
  const agentType = AGENT_TYPE_STYLES[agent.agentType || "specialist"] ?? AGENT_TYPE_STYLES.specialist;

  return (
    <Card
      className="group cursor-pointer transition-shadow hover:ring-foreground/20"
      onClick={() => router.push(`/agents/${agent.id}`)}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Bot className="size-4 text-muted-foreground" />
            </div>
            <CardTitle className="truncate">{agent.name}</CardTitle>
          </div>
          <Badge
            variant="secondary"
            className={`shrink-0 ${status.className}`}
          >
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <CardDescription className="line-clamp-2 leading-relaxed">
          {agent.description || "No description provided."}
        </CardDescription>
      </CardContent>

      <CardFooter className="gap-2">
        <Badge variant="secondary" className={source.className}>
          {source.label}
        </Badge>
        <Badge variant="secondary" className={agentType.className}>
          {agentType.label}
        </Badge>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Cpu className="size-3" />
          {agent.model}
        </span>
        {onStop && agent.status === "running" && (
          <button
            onClick={handleStop}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-amber-500 hover:bg-amber-500/10 transition-colors"
            aria-label={`Stop ${agent.name}`}
            title="Stop agent"
          >
            <StopCircle className="size-3.5" />
          </button>
        )}
        {onDelete && agent.status !== "running" && (
          <button
            onClick={handleDelete}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            aria-label={`Delete ${agent.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </CardFooter>
    </Card>
  );
}

export { SOURCE_STYLES, STATUS_STYLES };
export type { Agent };
