"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Bot, Clock, Loader2, SendHorizontal, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DocumentDetail {
  id: string;
  title: string;
  content: string;
  agentId: string | null;
  agentName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  createdAt: string;
  run: { status: string; durationMs: number | null; costEstimate: number | null } | null;
}

interface Reply {
  id: string;
  content: string;
  createdAt: string;
}

// A thread entry is either a user reply or an agent document response
type ThreadEntry =
  | { kind: "reply"; id: string; content: string; createdAt: string }
  | { kind: "agent"; id: string; content: string; agentName: string | null; createdAt: string };

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Fetch follow-up documents (agent responses after the first) for this task
  const fetchFollowUpDocs = useCallback(async (taskId: string, afterDocId: string): Promise<ThreadEntry[]> => {
    const res = await fetch(`/api/documents?taskId=${taskId}`);
    if (!res.ok) return [];
    const docs: DocumentDetail[] = await res.json();
    return docs
      .filter((d) => d.id !== afterDocId)
      .map((d) => ({
        kind: "agent" as const,
        id: d.id,
        content: d.content,
        agentName: d.agentName,
        createdAt: d.createdAt,
      }));
  }, []);

  const buildThread = useCallback(
    async (docData: DocumentDetail, replies: Reply[]) => {
      const replyEntries: ThreadEntry[] = replies.map((r) => ({
        kind: "reply",
        id: r.id,
        content: r.content,
        createdAt: r.createdAt,
      }));

      let agentResponses: ThreadEntry[] = [];
      if (docData.taskId) {
        agentResponses = await fetchFollowUpDocs(docData.taskId, docData.id);
      }

      const all = [...replyEntries, ...agentResponses].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      setThread(all);
    },
    [fetchFollowUpDocs],
  );

  useEffect(() => {
    Promise.all([
      fetch(`/api/documents/${id}`).then((r) => r.json()),
      fetch(`/api/documents/${id}/replies`).then((r) => r.json()),
    ]).then(([docData, repliesData]) => {
      setDoc(docData);
      buildThread(docData, repliesData);
      setLoading(false);
    });
  }, [id, buildThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread, agentRunning]);

  // Poll for new agent response doc while agent is running
  const startPolling = useCallback(
    (taskId: string, runId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        // Check run status
        const runRes = await fetch(`/api/runs/${runId}`);
        if (!runRes.ok) return;
        const run = await runRes.json();

        if (run.status === "success" || run.status === "failed") {
          stopPolling();
          setAgentRunning(false);
          // Refresh thread
          const [repliesRes, docData] = await Promise.all([
            fetch(`/api/documents/${id}/replies`).then((r) => r.json()),
            fetch(`/api/documents/${id}`).then((r) => r.json()),
          ]);
          buildThread(docData, repliesRes);
        }
      }, 3000);
    },
    [id, buildThread, stopPolling],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  const sendReply = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending || !doc) return;
    setSending(true);
    setInput("");

    // Save the reply
    const res = await fetch(`/api/documents/${id}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: trimmed }),
    });

    if (res.ok) {
      const reply = await res.json();
      setThread((prev) => [
        ...prev,
        { kind: "reply", id: reply.id, content: reply.content, createdAt: reply.createdAt },
      ]);

      // Trigger agent rerun if we have the context to do so
      if (doc.agentId && doc.taskId) {
        setAgentRunning(true);
        const runRes = await fetch(`/api/agents/${doc.agentId}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: doc.taskId,
            input: trimmed,
          }),
        });
        if (runRes.ok) {
          const { runId } = await runRes.json();
          startPolling(doc.taskId, runId);
        } else {
          setAgentRunning(false);
        }
      }
    }

    setSending(false);
  }, [id, input, sending, doc, startPolling]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Document not found</p>
        <Button variant="outline" size="sm" onClick={() => router.push("/documents")}>
          Back to documents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-3">
        <div className="mx-auto max-w-3xl flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => router.push("/documents")}
            className="shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{doc.title}</h1>
            <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
              {doc.agentName && (
                <span className="flex items-center gap-1">
                  <Bot className="size-3" />
                  {doc.agentName}
                </span>
              )}
              {doc.taskTitle && (
                <span className="truncate max-w-[200px]">{doc.taskTitle}</span>
              )}
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="size-3" />
                {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          {/* Original document */}
          <AgentBubble
            content={doc.content}
            agentName={doc.agentName}
            createdAt={doc.createdAt}
          />

          {/* Thread: interleaved replies and agent responses */}
          {thread.map((entry) =>
            entry.kind === "reply" ? (
              <UserBubble key={entry.id} content={entry.content} createdAt={entry.createdAt} />
            ) : (
              <AgentBubble
                key={entry.id}
                content={entry.content}
                agentName={entry.agentName}
                createdAt={entry.createdAt}
              />
            ),
          )}

          {/* Agent thinking indicator */}
          {agentRunning && (
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="size-3.5 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {doc.agentName ?? "Agent"} is working on a response...
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Reply input */}
      <div className="shrink-0 border-t border-border bg-background px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                doc.agentId
                  ? `Reply to ${doc.agentName ?? "the agent"} — clarify context, correct assumptions, add information...`
                  : "Add a note to this document..."
              }
              rows={3}
              disabled={sending || agentRunning}
              className={cn(
                "w-full resize-none rounded-xl border border-border bg-muted/30 px-4 py-3 pr-12 text-sm leading-relaxed outline-none transition-colors",
                "placeholder:text-muted-foreground/50",
                "focus:border-ring focus:ring-2 focus:ring-ring/20",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            />
            <Button
              size="icon-sm"
              variant={input.trim() ? "default" : "ghost"}
              className="absolute bottom-2.5 right-2.5"
              disabled={!input.trim() || sending || agentRunning}
              onClick={sendReply}
            >
              <SendHorizontal className="size-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground/50">
            {doc.agentId
              ? "Your reply triggers a new run — the agent will respond with updated context."
              : "Replies are stored as context for future runs."}{" "}
            <kbd className="rounded border border-border/50 px-1 font-mono">Enter</kbd> to send ·{" "}
            <kbd className="rounded border border-border/50 px-1 font-mono">Shift+Enter</kbd> for new line
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentBubble({
  content,
  agentName,
  createdAt,
}: {
  content: string;
  agentName: string | null;
  createdAt: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="size-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-medium">{agentName ?? "Agent"}</span>
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
          </span>
        </div>
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ content, createdAt }: { content: string; createdAt: string }) {
  return (
    <div className="flex gap-3 flex-row-reverse">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <User className="size-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5 flex-row-reverse">
          <span className="text-xs font-medium">You</span>
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
          </span>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}
