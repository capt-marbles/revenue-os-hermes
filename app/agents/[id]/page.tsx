"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { ChatInterface } from "@/components/copilot/chat-interface";
import { Button } from "@/components/ui/button";
import { Loader2Icon, Bot, StopCircle } from "lucide-react";
import {
  ConversationList,
  type Conversation,
} from "@/components/copilot/conversation-list";

interface Agent {
  id: string;
  name: string;
  slug: string;
  agentType: string;
  description: string;
  model: string;
  status: string;
}

interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status?: string;
  createdAt: string;
}

export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const attemptedInitRef = useRef(false);

  const upsertConversation = useCallback((convo: Conversation) => {
    setConversations((prev) => [convo, ...prev.filter((c) => c.id !== convo.id)]);
  }, []);

  const loadConversation = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/copilot/conversations/${convId}`);
      if (!res.ok) throw new Error("Failed to load conversation");
      const data = await res.json();
      setCurrentConversationId(convId);
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
      setCurrentConversationId(convId);
    }
  }, []);

  const bootstrap = useCallback(async (agentRecord: Agent) => {
    try {
      setError(null);
      const res = await fetch(`/api/copilot/conversations?agentId=${agentRecord.id}`);
      if (!res.ok) throw new Error("Failed to load conversations");
      let convos: Conversation[] = await res.json();

      if (convos.length === 0 && !attemptedInitRef.current) {
        attemptedInitRef.current = true;
        const createRes = await fetch("/api/copilot/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerAgentId: agentRecord.id }),
        });
        if (!createRes.ok) throw new Error("Failed to create conversation");
        const newConvo = await createRes.json();
        convos = [newConvo];
      }

      setConversations(convos);
      if (convos.length > 0) await loadConversation(convos[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [loadConversation]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/agents/${id}`);
        if (!res.ok) throw new Error("Agent not found");
        const agentData: Agent = await res.json();
        setAgent(agentData);
        await bootstrap(agentData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Agent not found");
        setLoading(false);
      }
    })();
  }, [id, bootstrap]);

  const handleStop = useCallback(async () => {
    if (!agent || stopping) return;
    setStopping(true);
    try {
      await fetch(`/api/agents/${agent.id}/stop`, { method: "POST" });
      setAgent((prev) => prev ? { ...prev, status: "idle" } : prev);
    } finally {
      setStopping(false);
    }
  }, [agent, stopping]);

  const createNewConversation = useCallback(async () => {
    if (!agent) return;
    try {
      const res = await fetch("/api/copilot/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAgentId: agent.id }),
      });
      if (!res.ok) throw new Error("Failed to create conversation");
      const newConvo: Conversation = await res.json();
      upsertConversation(newConvo);
      setCurrentConversationId(newConvo.id);
      setMessages([]);
    } catch (err) {
      console.error("Failed to create conversation:", err);
    }
  }, [agent, upsertConversation]);

  if (loading) {
    return (
      <PageShell title="Agent">
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (error || !agent) {
    return (
      <PageShell title="Agent">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
              <Bot className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-destructive">{error ?? "Agent not found"}</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={agent.name}
      description={agent.description || undefined}
      actions={
        <div className="flex items-center gap-2">
          {agent.status === "running" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              disabled={stopping}
              className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
            >
              {stopping ? (
                <Loader2Icon className="size-3.5 animate-spin" data-icon="inline-start" />
              ) : (
                <StopCircle className="size-3.5" data-icon="inline-start" />
              )}
              {stopping ? "Stopping..." : "Stop"}
            </Button>
          )}
          <ConversationList
            conversations={conversations}
            currentId={currentConversationId}
            onSelect={(convId) => loadConversation(convId)}
            onNew={createNewConversation}
          />
        </div>
      }
    >
      {currentConversationId && (
        <ChatInterface
          conversationId={currentConversationId}
          deskId={agent.slug}
          initialMessages={messages}
          actionDecisions={[]}
          briefing={null}
          onRefreshBriefing={() => {}}
          briefingLoading={false}
          briefingUpdatedAt={null}
        />
      )}
    </PageShell>
  );
}
