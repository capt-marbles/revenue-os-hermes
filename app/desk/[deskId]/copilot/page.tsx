"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { ChatInterface } from "@/components/copilot/chat-interface";
import {
  ConversationList,
  type Conversation,
} from "@/components/copilot/conversation-list";
import { ApprovalToastStack } from "@/components/copilot/approval-toast";
import { useApprovals } from "@/hooks/useApprovals";
import { Loader2Icon, BrainCircuit } from "lucide-react";

interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ActionDecision {
  id: string;
  messageId: string;
  actionKey: string;
  status: "approved" | "dismissed";
  resultMessage: string | null;
}

interface BriefingData {
  markdown: string;
  structured: {
    goals: Array<{
      id: string;
      title: string;
      status: string;
      targetValue: number | null;
      currentValue: number | null;
      unit: string | null;
      deadline: string | null;
      taskCount: number;
      tasksDone: number;
      progress: number;
    }>;
    taskDistribution: Record<string, number>;
    agentPerformance: Array<{
      agentId: string;
      agentName: string;
      runs: number;
      successes: number;
      successRate: number;
      totalCost: number;
      avgDuration: number;
    }>;
    recentRuns: Array<{
      agentName: string;
      status: string;
      durationMs: number | null;
      costEstimate: number | null;
      taskTitle: string | null;
      createdAt: string;
    }>;
    memoryCategories: Array<{ category: string; count: number }>;
    totals: {
      totalRuns7d: number;
      successRate: number;
      totalCost: number;
      avgDuration: number;
    };
  };
}

export default function DeskCopilotPage() {
  const { deskId } = useParams<{ deskId: string }>();
  const [deskName, setDeskName] = useState<string>("Desk");
  const [deskDescription, setDeskDescription] = useState<string>("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [actionDecisions, setActionDecisions] = useState<ActionDecision[]>([]);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);

  // Approval toast system
  const { approvals, resolveApproval, dismissApproval } = useApprovals({ deskId });
  const [briefingUpdatedAt, setBriefingUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track current deskId to prevent stale async updates
  const activeDeskRef = useRef(deskId);
  const attemptedInitialConversationRef = useRef(false);

  function upsertConversation(conversation: Conversation) {
    setConversations((prev) => {
      const withoutConversation = prev.filter((item) => item.id !== conversation.id);
      return [conversation, ...withoutConversation];
    });
  }

  async function loadConversation(id: string) {
    try {
      const res = await fetch(`/api/copilot/conversations/${id}`);
      if (!res.ok) throw new Error("Failed to load conversation");
      const data = await res.json();
      setCurrentConversationId(id);
      setMessages(data.messages || []);
      setActionDecisions(data.actionDecisions || []);
    } catch {
      setMessages([]);
      setActionDecisions([]);
      setCurrentConversationId(id);
    }
  }

  async function createNewConversation() {
    try {
      const res = await fetch("/api/copilot/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deskId }),
      });
      if (!res.ok) throw new Error("Failed to create conversation");
      const newConvo: Conversation = await res.json();
      upsertConversation(newConvo);
      setCurrentConversationId(newConvo.id);
      setMessages([]);
      setActionDecisions([]);
    } catch (err) {
      console.error("Failed to create new conversation:", err);
    }
  }

  function refreshBriefing() {
    setBriefingLoading(true);
    fetch(`/api/copilot/briefing?deskId=${deskId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && activeDeskRef.current === deskId) {
          setBriefing(data);
          setBriefingUpdatedAt(new Date());
        }
      })
      .catch(() => {})
      .finally(() => setBriefingLoading(false));
  }

  // Fetch desk name + description
  useEffect(() => {
    fetch(`/api/desks/${deskId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setDeskName(data.name ?? "Desk");
          setDeskDescription(data.description ?? "");
        }
      })
      .catch(() => {});
  }, [deskId]);

  // Main effect: reset and bootstrap when deskId changes
  useEffect(() => {
    activeDeskRef.current = deskId;

    // Reset state
    setConversations([]);
    setCurrentConversationId(null);
    setMessages([]);
    setActionDecisions([]);
    setBriefing(null);
    setLoading(true);
    setBriefingLoading(true);
    setError(null);
    attemptedInitialConversationRef.current = false;

    // Bootstrap conversations for THIS desk
    (async () => {
      try {
        const res = await fetch(`/api/copilot/conversations?deskId=${deskId}`);
        if (!res.ok) throw new Error("Failed to load conversations");
        if (activeDeskRef.current !== deskId) return; // Stale

        let convos: Conversation[] = await res.json();

        if (convos.length === 0 && !attemptedInitialConversationRef.current) {
          attemptedInitialConversationRef.current = true;
          const createRes = await fetch("/api/copilot/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deskId }),
          });
          if (!createRes.ok) throw new Error("Failed to create conversation");
          if (activeDeskRef.current !== deskId) return; // Stale
          const newConvo = await createRes.json();
          convos = [newConvo];
        }

        if (activeDeskRef.current !== deskId) return; // Stale
        setConversations(convos);
        if (convos[0]) await loadConversation(convos[0].id);
      } catch (err) {
        if (activeDeskRef.current === deskId) {
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        if (activeDeskRef.current === deskId) {
          setLoading(false);
        }
      }
    })();

    // Fetch briefing
    fetch(`/api/copilot/briefing?deskId=${deskId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && activeDeskRef.current === deskId) {
          setBriefing(data);
          setBriefingUpdatedAt(new Date());
        }
      })
      .catch(() => {})
      .finally(() => {
        if (activeDeskRef.current === deskId) setBriefingLoading(false);
      });
  }, [deskId]);

  if (loading) {
    return (
      <PageShell title={deskName} description={deskDescription}>
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title={deskName} description={deskDescription}>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
              <BrainCircuit className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-destructive">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Reload page
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={deskName}
      description={deskDescription}
      actions={
        <ConversationList
          conversations={conversations}
          currentId={currentConversationId}
          onSelect={(id) => loadConversation(id)}
          onNew={createNewConversation}
        />
      }
    >
      {currentConversationId && (
        <ChatInterface
          conversationId={currentConversationId}
          deskId={deskId}
          initialMessages={messages}
          actionDecisions={actionDecisions}
          briefing={briefing}
          onRefreshBriefing={refreshBriefing}
          briefingLoading={briefingLoading}
          briefingUpdatedAt={briefingUpdatedAt}
        />
      )}
      <ApprovalToastStack
        approvals={approvals}
        onResolve={resolveApproval}
        onDismiss={dismissApproval}
      />
    </PageShell>
  );
}