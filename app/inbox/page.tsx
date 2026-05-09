"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { TaskCard, type Task } from "@/components/tasks/task-card";
import { Loader2Icon, MessageSquareTextIcon, BellRingIcon } from "lucide-react";
import { toast } from "sonner";

interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

function isSystemConversation(conversation: Conversation) {
  const title = conversation.title || "";
  return title.startsWith("webhook:") || title.startsWith("telegram:");
}

function formatTitle(title: string | null) {
  if (!title) return "Untitled conversation";
  if (title.startsWith("webhook:")) {
    return `Webhook: ${title.replace("webhook:", "")}`;
  }
  if (title.startsWith("telegram:")) {
    return `Telegram: ${title.replace("telegram:", "")}`;
  }
  return title;
}

export default function InboxPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInbox = useCallback(async () => {
    try {
      setLoading(true);
      const [taskRes, convoRes] = await Promise.all([
        fetch("/api/tasks?approval_status=pending"),
        fetch("/api/copilot/conversations"),
      ]);

      if (!taskRes.ok || !convoRes.ok) {
        throw new Error("Failed to load inbox");
      }

      const [taskData, convoData] = await Promise.all([
        taskRes.json(),
        convoRes.json(),
      ]);

      setTasks(Array.isArray(taskData) ? taskData : []);
      setConversations(Array.isArray(convoData) ? convoData : []);
    } catch (err) {
      console.error("Failed to load inbox:", err);
      toast.error("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const systemConversations = useMemo(
    () => conversations.filter(isSystemConversation),
    [conversations],
  );

  const handleApprove = useCallback(
    async (taskId: string) => {
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalStatus: "approved", status: "todo" }),
        });
        if (!res.ok) fetchInbox();
      } catch {
        fetchInbox();
      }
    },
    [fetchInbox],
  );

  const handleReject = useCallback(
    async (taskId: string) => {
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalStatus: "approved", status: "blocked" }),
        });
        if (!res.ok) fetchInbox();
      } catch {
        fetchInbox();
      }
    },
    [fetchInbox],
  );

  return (
    <PageShell
      title="Inbox"
      description="Review pending approvals and event-driven Chief of Staff conversations"
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <BellRingIcon className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Pending Approvals</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {tasks.length}
              </span>
            </div>

            {tasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                No approval-gated tasks right now.
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquareTextIcon className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Event Conversations</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {systemConversations.length}
              </span>
            </div>

            {systemConversations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                No event-driven conversations yet.
              </div>
            ) : (
              <div className="space-y-3">
                {systemConversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/copilot?conversation=${conversation.id}`}
                    className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {formatTitle(conversation.title)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Updated {new Date(conversation.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {conversation.messageCount ?? 0} msgs
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
