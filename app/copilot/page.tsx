"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { ChatInterface } from "@/components/copilot/chat-interface";
import { ApprovalToastStack } from "@/components/copilot/approval-toast";
import { useApprovals } from "@/hooks/useApprovals";
import {
  ConversationList,
  type Conversation,
} from "@/components/copilot/conversation-list";
import { Loader2Icon, BrainCircuit } from "lucide-react";
import { useSearchParams } from "next/navigation";

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

export default function CopilotPage() {
  return (
    <Suspense
      fallback={
        <PageShell title="Co-Pilot">
          <div className="flex h-full items-center justify-center">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        </PageShell>
      }
    >
      <CopilotContent />
    </Suspense>
  );
}

function CopilotContent() {
  const searchParams = useSearchParams();
  const { approvals, resolveApproval, dismissApproval } = useApprovals();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [actionDecisions, setActionDecisions] = useState<ActionDecision[]>([]);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [briefingUpdatedAt, setBriefingUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const attemptedInitialConversationRef = useRef(false);

  const upsertConversation = useCallback((conversation: Conversation) => {
    setConversations((prev) => {
      const withoutConversation = prev.filter((item) => item.id !== conversation.id);
      return [conversation, ...withoutConversation];
    });
  }, []);

  // Fetch briefing
  const fetchBriefing = useCallback(async () => {
    try {
      setBriefingLoading(true);
      const res = await fetch("/api/copilot/briefing");
      if (!res.ok) throw new Error("Failed to load briefing");
      const data = await res.json();
      setBriefing(data);
      setBriefingUpdatedAt(new Date());
    } catch {
      // Briefing is non-critical — silently fail
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  // Fetch conversations and bootstrap
  const bootstrap = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const res = await fetch("/api/copilot/conversations?agentSlug=chief-of-staff");
      if (!res.ok) throw new Error("Failed to load conversations");
      let convos: Conversation[] = await res.json();

      // Auto-create conversation if none exist
      if (convos.length === 0 && !attemptedInitialConversationRef.current) {
        attemptedInitialConversationRef.current = true;
        const createRes = await fetch("/api/copilot/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!createRes.ok) throw new Error("Failed to create conversation");
        const newConvo = await createRes.json();
        convos = [newConvo];
      }

      setConversations(convos);

      const requestedConversationId = searchParams.get("conversation");
      const preferred =
        (requestedConversationId &&
          convos.find((conversation) => conversation.id === requestedConversationId)) ||
        convos[0];

      await loadConversation(preferred.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  const loadConversation = async (id: string) => {
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
  };

  const createNewConversation = useCallback(async () => {
    try {
      const res = await fetch("/api/copilot/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
  }, [upsertConversation]);

  useEffect(() => {
    bootstrap();
    fetchBriefing();
  }, [bootstrap, fetchBriefing]);

  if (loading) {
    return (
      <PageShell title="Chief of Staff" description="Your primary operating interface">
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="Chief of Staff" description="Your primary operating interface">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
              <BrainCircuit className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-destructive">{error}</p>
            <button
              onClick={() => bootstrap()}
              className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Try again
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Chief of Staff"
      description="Your primary operating interface"
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
          initialMessages={messages}
          actionDecisions={actionDecisions}
          briefing={briefing}
          onRefreshBriefing={fetchBriefing}
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
