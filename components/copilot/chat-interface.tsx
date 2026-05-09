"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type KeyboardEvent,
} from "react";
import { SendHorizontal, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageBubble } from "./message-bubble";
import { BriefingSidebar } from "./briefing-sidebar";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status?: string; // pending | done | error
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

interface ChatInterfaceProps {
  conversationId: string;
  deskId?: string;
  initialMessages: Message[];
  actionDecisions: ActionDecision[];
  briefing: BriefingData | null;
  onRefreshBriefing: () => void;
  briefingLoading: boolean;
  briefingUpdatedAt: Date | null;
}

const SUGGESTED_PROMPTS = [
  "What should I focus on this week?",
  "Which goals are at risk?",
  "Review specialist performance",
];

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

export function ChatInterface({
  conversationId,
  deskId,
  initialMessages,
  actionDecisions,
  briefing,
  onRefreshBriefing,
  briefingLoading,
  briefingUpdatedAt,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-20250514");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset streaming state on mount (handles stale state from page navigation)
  useEffect(() => {
    setIsStreaming(false);
  }, []);

  // Refresh briefing whenever a goal is created/updated via an action card approval
  useEffect(() => {
    const handler = () => setTimeout(() => onRefreshBriefing(), 800);
    window.addEventListener("goal-updated", handler);
    return () => window.removeEventListener("goal-updated", handler);
  }, [onRefreshBriefing]);

  // Load available models
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data: ModelOption[]) => {
        setModelOptions(data);
      })
      .catch(() => {});
  }, []);

  // Sync initialMessages when conversation changes
  useEffect(() => {
    setMessages(initialMessages);
    setIsStreaming(false);
  }, [initialMessages]);

  // On mount, immediately resolve any pending messages left from a previous session
  // or a tab switch — don't wait for the 2s interval to fire.
  useEffect(() => {
    if (!messages.some((m) => m.status === "pending")) return;
    fetch(`/api/copilot/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data) => { if (data.messages) setMessages(data.messages); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Poll for pending messages — continues working even if you switch tabs
  const hasPending = !isStreaming && messages.some((m) => m.status === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/copilot/conversations/${conversationId}`);
        if (!res.ok) return;
        const data = await res.json();
        const updated: Message[] = data.messages ?? [];
        setMessages(updated);
        if (!updated.some((m) => m.status === "pending")) {
          clearInterval(interval);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [hasPending, conversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Fetch fresh briefings from specialist agents and inject as user context messages
  const fetchAgentBriefings = useCallback(
    async (slugs: string[], convoId: string) => {
      for (const slug of slugs) {
        try {
          const res = await fetch("/api/copilot/agent-briefing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deskSlug: slug, limit: 3 }),
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (data.messages.length === 0) continue;

          // Inject as a system context message
          const contextMsg = data.messages
            .map((m: { content: string }) => m.content)
            .join("\n\n---\n\n");

          setMessages((prev) => [
            ...prev,
            {
              id: `sync-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              role: "user" as const,
              content: `[Auto-synced from ${data.desk}]\n\n${contextMsg}`,
              conversationId: convoId,
              createdAt: new Date().toISOString(),
            },
          ]);
        } catch {
          // Silently fail — sync is best-effort
        }
      }
    },
    []
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      // Add user message
      const userMsg: Message = {
        id: `temp-${Date.now()}`,
        conversationId,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Add placeholder assistant message
      const assistantId = `temp-assistant-${Date.now()}`;
      const assistantMsg: Message = {
        id: assistantId,
        conversationId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsStreaming(true);
      // Will be updated to the real server ULID when the message_id event arrives
      let realAssistantId = assistantId;

      try {
        const res = await fetch("/api/copilot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message: trimmed, deskId, model: selectedModel }),
        });

        if (!res.ok) {
          throw new Error("Chat request failed");
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last partial line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.type === "message_id") {
                // Swap the client-generated temp ID for the real server ULID so
                // persisted action decisions map correctly on reload.
                realAssistantId = payload.id as string;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, id: realAssistantId } : m
                  )
                );
              } else if (payload.type === "text") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === realAssistantId
                      ? { ...m, content: m.content + payload.text }
                      : m
                  )
                );
              } else if (payload.type === "done") {
                if (payload.code !== 0) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === realAssistantId && !m.content
                        ? { ...m, content: "The agent is starting up — please try again in a moment." }
                        : m
                    )
                  );
                } else {
                  // streaming complete — check for agent sync requests and refresh briefing
                  setMessages((prev) => {
                    const lastMsg = prev.find((m) => m.id === realAssistantId);
                    if (!lastMsg?.content) return prev;

                    const syncMatches = lastMsg.content.matchAll(/\[sync:(\w[-\w]*)\]/g);
                    const slugs = [...syncMatches].map((m) => m[1]);
                    if (slugs.length > 0) {
                      fetchAgentBriefings(slugs, conversationId);
                    }
                    return prev;
                  });
                  // Refresh briefing and goals page after every CoS response so
                  // tool-call side-effects (goal updates, etc.) are reflected immediately.
                  setTimeout(() => {
                    onRefreshBriefing();
                    window.dispatchEvent(new Event("goal-updated"));
                  }, 1500);
                }
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === realAssistantId
              ? {
                  ...m,
                  content:
                    "I ran into an issue processing your request. Please try again.",
                }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [conversationId, deskId, isStreaming, selectedModel]
  );

  const handleModelChange = useCallback(
    (v: string | null) => setSelectedModel(v ?? "claude-sonnet-4-20250514"),
    [],
  );

  const isEmpty = messages.length === 0;
  const decisionsByMessage = useMemo(() => {
    const map: Record<string, Record<string, { status: "approved" | "dismissed"; resultMessage?: string | null }>> = {};
    for (const decision of actionDecisions) {
      if (!map[decision.messageId]) map[decision.messageId] = {};
      map[decision.messageId][decision.actionKey] = {
        status: decision.status,
        resultMessage: decision.resultMessage,
      };
    }
    return map;
  }, [actionDecisions]);

  return (
    <div className="flex flex-1 min-h-0 h-full">
      {/* Main chat area */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          {isEmpty ? (
            <EmptyState
              onSelect={(prompt) => sendMessage(prompt)}
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  id={msg.id}
                  conversationId={conversationId}
                  role={msg.role}
                  content={msg.content}
                  createdAt={msg.createdAt}
                  deskId={deskId}
                  actionDecisions={decisionsByMessage[msg.id]}
                  isStreaming={
                    (isStreaming && msg.role === "assistant" && i === messages.length - 1) ||
                    msg.status === "pending"
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Input area — isolated component so keystrokes don't re-render the message list */}
        <ChatInputArea
          isStreaming={isStreaming}
          selectedModel={selectedModel}
          modelOptions={modelOptions}
          onModelChange={handleModelChange}
          onSend={sendMessage}
        />
      </div>

      {/* Briefing sidebar */}
      <BriefingSidebar
        data={briefing}
        loading={briefingLoading}
        onRefresh={onRefreshBriefing}
        lastUpdated={briefingUpdatedAt}
      />
    </div>
  );
}

const ChatInputArea = memo(function ChatInputArea({
  isStreaming,
  selectedModel,
  modelOptions,
  onModelChange,
  onSend,
}: {
  isStreaming: boolean;
  selectedModel: string;
  modelOptions: ModelOption[];
  onModelChange: (v: string | null) => void;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onSend(input);
      setInput("");
    }
  };

  const handleSend = () => {
    onSend(input);
    setInput("");
  };

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your Chief of Staff anything..."
            disabled={isStreaming}
            rows={3}
            className={cn(
              "w-full resize-none rounded-xl border border-border bg-muted/30 px-4 py-3 pr-12 text-sm leading-relaxed outline-none transition-colors",
              "placeholder:text-muted-foreground/50",
              "focus:border-ring focus:ring-2 focus:ring-ring/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          />
          <Button
            size="icon-sm"
            variant={input.trim() ? "default" : "ghost"}
            className="absolute bottom-2.5 right-2.5"
            disabled={!input.trim() || isStreaming}
            onClick={handleSend}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <Select value={selectedModel} onValueChange={onModelChange}>
            <SelectTrigger size="sm" className="h-6 gap-1 border-none bg-muted/50 px-2 text-[11px] shadow-none hover:bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground/50">
            <kbd className="rounded border border-border/50 px-1 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to send ·{" "}
            <kbd className="rounded border border-border/50 px-1 py-0.5 font-mono text-[10px]">
              Shift+Enter
            </kbd>{" "}
            for new line
          </p>
        </div>
      </div>
    </div>
  );
});

function EmptyState({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/5">
        <BrainCircuit className="size-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">
        What&apos;s on your mind?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your co-pilot has full context on goals, tasks, and agents.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            className={cn(
              "rounded-full border border-border bg-background px-4 py-2 text-sm transition-colors",
              "hover:bg-muted hover:border-foreground/15",
              "active:scale-[0.98]"
            )}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
