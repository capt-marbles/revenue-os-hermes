import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db } from "@/db";
import {
  agents,
  copilotConversations,
  copilotMessages,
  desks,
  documents,
  goals,
} from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import { classifyAndStoreMemory } from "@/lib/memory/classifier";
import { assembleBriefing } from "@/lib/agents/copilot-briefing";
import { buildCopilotPrompt } from "@/lib/agents/copilot-prompt";
import {
  extractKeywords,
  formatWikiForPrompt,
  queryWiki,
} from "@/lib/agents/wiki-query";
import { runCoSAgenticChat } from "@/lib/agents/cos-agentic-chat";
import { runProfileAgenticChat } from "@/lib/agents/profile-agentic-chat";
import { runClaudeCliChat } from "@/lib/agents/claude-cli-chat";
import {
  getChiefOfStaffCodexSandboxMode,
  resolveChiefOfStaffRuntime,
} from "@/lib/copilot/runtime-selection";
import {
  getRuntime,
  getRuntimeById,
  getOpenClawAgentForDesk,
  buildSessionKey,
} from "@/lib/runtime";

// Desks routed through OpenRouter + SOUL.md + scoped tools.
// Tool-calling capable.
const PROFILE_AGENTIC_DESKS = new Set([
  "steward",
  "scout",
  "sales-engineering",
]);

// Desks routed through the local Claude Code CLI (Max subscription, $0
// marginal cost). Text-only; no tool calling. Checked before
// PROFILE_AGENTIC_DESKS so a desk listed here takes the CLI path.
const CLAUDE_CLI_DESKS = new Set(["outreach", "marketing"]);

const chatSchema = z.object({
  conversationId: z.string(),
  message: z.string().min(1),
  deskId: z.string().optional(),
  model: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Shared streaming response with background persistence
//
// The agentCallFn runs detached from the SSE stream — it continues even if
// the client navigates away. When it completes it updates the DB row.
// The SSE stream forwards chunks while the client is connected.
// ---------------------------------------------------------------------------

type AgentCallbacks = {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
};

interface StreamContext {
  tenantId: string;
  deskSlug: string;
  userMessage: string;
}

function createPersistentStream(
  assistantMsgId: string,
  accumulated: { value: string },
  agentCallFn: (cbs: AgentCallbacks) => void,
  ctx?: StreamContext,
): Response {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  function safeEnqueue(data: string) {
    try {
      controller?.enqueue(encoder.encode(data));
    } catch {
      // Client disconnected — ignore
    }
  }

  // Periodically flush partial content to DB so tab-switchers see progress.
  // Writes every 3 s; stops once the agent calls onDone/onError.
  let flushInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (accumulated.value) {
      db.update(copilotMessages)
        .set({ content: accumulated.value })
        .where(eq(copilotMessages.id, assistantMsgId))
        .run();
    }
  }, 3000);

  function stopFlush() {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
  }

  // Emit the real server-assigned message ID immediately so the client can
  // replace its temp placeholder ID before any decisions are persisted.
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      safeEnqueue(`data: ${JSON.stringify({ type: "message_id", id: assistantMsgId })}\n\n`);
    },
    cancel() {
      // Client navigated away — background work continues, controller is nulled
      controller = null;
    },
  });

  // Start agent work fully detached from the stream lifecycle
  agentCallFn({
    onChunk(text) {
      accumulated.value += text;
      safeEnqueue(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
    },
    onDone() {
      stopFlush();
      db.update(copilotMessages)
        .set({ content: accumulated.value, status: "done" })
        .where(eq(copilotMessages.id, assistantMsgId))
        .run();
      safeEnqueue(`data: ${JSON.stringify({ type: "done", code: 0 })}\n\n`);
      try {
        controller?.close();
      } catch {}
      // Fire-and-forget memory classification — runs after response is sent
      if (ctx && accumulated.value) {
        classifyAndStoreMemory(
          ctx.tenantId,
          ctx.deskSlug,
          ctx.userMessage,
          accumulated.value,
        ).catch(() => {});
      }
    },
    onError(msg) {
      stopFlush();
      const content = accumulated.value || msg;
      db.update(copilotMessages)
        .set({ content, status: "error" })
        .where(eq(copilotMessages.id, assistantMsgId))
        .run();
      safeEnqueue(`data: ${JSON.stringify({ type: "done", code: 1 })}\n\n`);
      try {
        controller?.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Shared conversation setup: load conversation, save user message, pre-insert
// a pending assistant message, load history, set title.
// ---------------------------------------------------------------------------

function setupConversation(
  conversationId: string,
  message: string,
  tenantId: string,
): {
  conversation: typeof copilotConversations.$inferSelect;
  history: (typeof copilotMessages.$inferSelect)[];
  assistantMsgId: string;
  accumulated: { value: string };
} | null {
  const conversation = db
    .select()
    .from(copilotConversations)
    .where(
      and(
        eq(copilotConversations.id, conversationId),
        eq(copilotConversations.tenantId, tenantId),
      ),
    )
    .get();

  if (!conversation) return null;

  // Save user message
  db.insert(copilotMessages)
    .values({ id: ulid(), conversationId, role: "user", content: message })
    .run();

  // Pre-insert pending assistant message (persists even if client disconnects)
  const assistantMsgId = ulid();
  db.insert(copilotMessages)
    .values({ id: assistantMsgId, conversationId, role: "assistant", content: "", status: "pending" })
    .run();

  const history = db
    .select()
    .from(copilotMessages)
    .where(eq(copilotMessages.conversationId, conversationId))
    .orderBy(asc(copilotMessages.createdAt))
    .all();

  // Set title on first real message
  if (!conversation.title && history.length <= 2) {
    const title = message.length > 60 ? `${message.slice(0, 57)}...` : message;
    db.update(copilotConversations)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(copilotConversations.id, conversationId))
      .run();
  }

  db.update(copilotConversations)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(copilotConversations.id, conversationId))
    .run();

  return { conversation, history, assistantMsgId, accumulated: { value: "" } };
}

// ---------------------------------------------------------------------------
// CoS agentic handler (tool calling)
// ---------------------------------------------------------------------------

async function handleCoSAgenticChat(
  conversationId: string,
  message: string,
  tenantId: string,
  model?: string,
): Promise<Response> {
  const setup = setupConversation(conversationId, message, tenantId);
  if (!setup) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { history, assistantMsgId, accumulated } = setup;

  const chiefOfStaff = db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.tenantId, tenantId),
        eq(agents.agentType, "chief_of_staff"),
        eq(agents.slug, "chief-of-staff"),
      ),
    )
    .get();

  const briefing = await assembleBriefing({ includeAgentDigests: false });

  const allGoals = db.select({ id: goals.id, title: goals.title }).from(goals).where(eq(goals.tenantId, tenantId)).all();
  const goalTitlesList = allGoals.length > 0
    ? allGoals.map((g) => `  - "${g.title}"`).join("\n")
    : "  (no goals yet)";

  const systemPrompt = [
    `You are ${chiefOfStaff?.name ?? "Chief of Staff"} for Gameye Revenue OS — a strategic sparring partner for the operator running AI-powered marketing and sales operations for Gameye, a B2B game server hosting platform.`,
    "",
    "## Decision tree — follow this exactly",
    "",
    "**Q: What has [agent/desk] done, built, or produced?**",
    "→ Call dispatch_agent([desk], 'What have you done or produced today? List any outputs, files, or tasks you completed.')",
    "→ Do this for EVERY desk mentioned. Do NOT skip any.",
    "→ Do NOT answer from memory, briefing, or GBrain. The agent's live response is the only valid answer.",
    "→ If the operator shows you an agent's output — believe it. Do not contradict it.",
    "",
    "**Q: Pipeline, goals, tasks, integrations, stats?**",
    "→ Answer from the briefing below. It is fresh.",
    "→ Only call a DB tool (get_goals, get_tasks, etc.) if the briefing genuinely lacks the answer.",
    "→ Cap: at most 2 DB tool calls per response.",
    "",
    "**Q: Strategy, prioritisation, recommendations?**",
    "→ Answer directly from the briefing. No tools needed.",
    "",
    "---",
    "",
    briefing.markdown,
    "",
    "---",
    "",
    "## Your tools — ONLY these exist. Do not invent others.",
    "- get_goals: goal progress and deadlines",
    "- get_tasks(search, status, assigneeSlug): find tasks by keyword/status/assignee",
    "- get_pipeline_summary: CRM pipeline overview",
    "- get_outreach_stats: email send/reply/meeting stats",
    "- get_agent_activity: agent run counts and success rates",
    "- get_tool_connections: which integrations are connected",
    "- dispatch_agent(agent, query): ask a specialist and get their response inline",
    "    valid agents: scout | steward | outreach | marketing | sales-engineering | leo",
    "- update_goal(goal_title, [title, description, priority, status, target_metric, target_value, current_value, unit, deadline]): amend an existing goal",
    "- create_goal(title, [description, priority, status, target_metric, target_value, unit, deadline]): add a new strategic goal",
    "- read_shared_memory(key?, category?, search?): read facts any desk has stored in shared memory",
    "- write_shared_memory(key, value, category): store a durable fact for all desks to read",
    "",
    "## Goal management — use tools directly, no approval blocks",
    "When the operator discusses goals, priorities, or strategy: call update_goal / create_goal tools immediately.",
    "Do NOT generate **Recommended Action** blocks for goal changes. Just call the tool and confirm what you did.",
    "You may call multiple goal tools in one response to update several goals at once.",
    `Current goals (use exact titles when calling update_goal):\n${goalTitlesList}`,
    "",
    "## Operator-approval blocks — only for tasks and agents",
    "Use **Recommended Action** blocks ONLY for create_task, trigger_agent, and update_memory.",
    "These require the operator's sign-off before executing. Format:",
    "",
    "**Recommended Action**: Write comparison landing page",
    "- Type: create_task",
    '- Title: Write "Multiplay alternative" comparison page',
    "- Priority: high",
    "- Goal: Rank #1 for Multiplay & Hathora alternatives",
    "- Agent: competitor-alternatives",
    "",
    "Valid approval-block types: create_task, trigger_agent, update_memory.",
    "",
    "## You do NOT have access to",
    "GBrain, filesystem, Hermes skill files, session history. Never claim to search these.",
    "If you catch yourself writing 'Let me search GBrain' or 'Found X in the filesystem' — STOP. That is hallucination.",
    "",
    "Dispatch triggers:",
    "  - Studios, ICP, leads, enrichment → scout",
    "  - Deals, CRM, contacts, pipeline → steward",
    "  - Email sequences, reply rates, campaigns → outreach",
    "  - Website, SEO, content, brand → marketing",
    "  - Technical integrations, demos, skill files → sales-engineering",
    "  - Past work, session history, GBrain knowledge → leo",
    "",
    "Never include `[sync:...]` tags. Do NOT reproduce specialist output verbatim — synthesize it.",
  ].join("\n");

  const recentHistory = history
    .filter((m) => m.status !== "pending" && m.content !== "")
    .slice(-20);

  const messages = recentHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return createPersistentStream(
    assistantMsgId,
    accumulated,
    ({ onChunk, onDone, onError }) => {
      runCoSAgenticChat(
        systemPrompt,
        messages,
        model ?? "claude-sonnet-4-6",
        {
          onData: onChunk,
          onError,
          onClose: (code) => {
            if (code === 0) onDone();
            else onError(`Agentic chat closed with code ${code}`);
          },
        },
        tenantId,
      );
    },
    { tenantId, deskSlug: "chief-of-staff", userMessage: message },
  );
}

// ---------------------------------------------------------------------------
// Generic profile agentic handler — SOUL.md + scoped tools via OpenRouter.
// Used for all non-CoS desks (steward, scout, outreach, marketing,
// sales-engineering). No Hermes gateway dependency.
// ---------------------------------------------------------------------------

async function handleProfileAgenticChat(
  conversationId: string,
  message: string,
  profile: string,
  tenantId: string,
  model?: string,
): Promise<Response> {
  // Frontend may pass an Anthropic-format model id (e.g. "claude-sonnet-4-…")
  // intended for the CoS Anthropic path. OpenRouter requires "<vendor>/<model>".
  // Ignore unprefixed model ids and let the handler use its default.
  const openRouterModel = model && model.includes("/") ? model : undefined;
  const setup = setupConversation(conversationId, message, tenantId);
  if (!setup) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { history, assistantMsgId, accumulated } = setup;

  const recentHistory = history
    .filter((m) => m.status !== "pending" && m.content !== "")
    .slice(-20);

  const messages = recentHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return createPersistentStream(
    assistantMsgId,
    accumulated,
    ({ onChunk, onDone, onError }) => {
      runProfileAgenticChat(
        messages,
        {
          onData: onChunk,
          onError: (msg) => {
            console.error(`[chat-route] ${profile} error:`, msg);
            onError(msg);
          },
          // onClose is no-op on error: the handler already called onError above,
          // and re-calling onError here would overwrite the real message in the DB.
          onClose: (code) => {
            if (code === 0) onDone();
          },
        },
        tenantId,
        { profile, model: openRouterModel },
      );
    },
    { tenantId, deskSlug: profile, userMessage: message },
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const tenantId = getTenantId();
  const body = await request.json();
  const parsed = chatSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { conversationId, message, deskId, model } = parsed.data;
  const effectiveDeskId = deskId ?? "chief-of-staff";

  if (effectiveDeskId === "chief-of-staff") {
    const chiefOfStaffRuntime = resolveChiefOfStaffRuntime(model);
    console.log(JSON.stringify({
      event: "copilot_runtime_selected",
      deskId: effectiveDeskId,
      runtimeId: chiefOfStaffRuntime.runtimeId,
      model: chiefOfStaffRuntime.model,
      timestamp: new Date().toISOString(),
    }));
    if (chiefOfStaffRuntime.runtimeId === "anthropic") {
      return handleCoSAgenticChat(
        conversationId,
        message,
        tenantId,
        chiefOfStaffRuntime.model,
      );
    }

    return handleRuntimeChat(
      conversationId,
      message,
      effectiveDeskId,
      tenantId,
      chiefOfStaffRuntime.model,
      chiefOfStaffRuntime.runtimeId,
    );
  }

  // Desks routed through local Claude Code CLI (Max subscription, $0 marginal)
  if (CLAUDE_CLI_DESKS.has(effectiveDeskId)) {
    return handleClaudeCliChat(
      conversationId,
      message,
      effectiveDeskId,
      tenantId,
    );
  }

  // All non-CoS desks with a Hermes profile go through OpenRouter + SOUL.md
  if (PROFILE_AGENTIC_DESKS.has(effectiveDeskId)) {
    return handleProfileAgenticChat(
      conversationId,
      message,
      effectiveDeskId,
      tenantId,
      model,
    );
  }

  const openClawAgent = getOpenClawAgentForDesk(effectiveDeskId);
  if (openClawAgent) {
    return handleOpenClawChat(conversationId, message, openClawAgent, tenantId);
  }
  if (model?.startsWith("ant:") || (model && process.env.ANTBASE_API_KEY && model.includes("/"))) {
    return handleAntbaseChat(conversationId, message, tenantId, model);
  }
  return handleRuntimeChat(conversationId, message, deskId, tenantId, model);
}

// ---------------------------------------------------------------------------
// Claude Code CLI handler — uses local `claude` binary via OAuth (Max plan).
// Text-only; no tool calling. Used for high-volume writing-quality desks.
// ---------------------------------------------------------------------------

async function handleClaudeCliChat(
  conversationId: string,
  message: string,
  profile: string,
  tenantId: string,
): Promise<Response> {
  const setup = setupConversation(conversationId, message, tenantId);
  if (!setup) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { history, assistantMsgId, accumulated } = setup;

  const recentHistory = history
    .filter((m) => m.status !== "pending" && m.content !== "")
    .slice(-20);

  const messages = recentHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return createPersistentStream(
    assistantMsgId,
    accumulated,
    ({ onChunk, onDone, onError }) => {
      runClaudeCliChat(
        messages,
        {
          onData: onChunk,
          onError: (msg) => {
            console.error(`[chat-route] ${profile} (claude-cli) error:`, msg);
            onError(msg);
          },
          onClose: (code) => {
            if (code === 0) onDone();
            // Non-zero close: error already raised via onError; don't double-fire.
          },
        },
        { profile, tenantId },
      );
    },
    { tenantId, deskSlug: profile, userMessage: message },
  );
}

// ---------------------------------------------------------------------------
// OpenClaw handler
// ---------------------------------------------------------------------------

function handleOpenClawChat(
  conversationId: string,
  message: string,
  agentId: string,
  tenantId: string,
): Response {
  const setup = setupConversation(conversationId, message, tenantId);
  if (!setup) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { assistantMsgId, accumulated } = setup;
  const sessionKey = buildSessionKey(agentId);

  return createPersistentStream(assistantMsgId, accumulated, ({ onChunk, onDone, onError }) => {
    // streamOpenClawChat already uses callbacks — plug in directly
    import("@/lib/runtime").then(({ streamOpenClawChat }) => {
      streamOpenClawChat(sessionKey, message, {
        onData: onChunk,
        onError,
        onClose: (code) => {
          if (code === 0) onDone();
          else onError(`OpenClaw closed with code ${code}`);
        },
      }).catch((err) => onError(err instanceof Error ? err.message : String(err)));
    });
  });
}

// ---------------------------------------------------------------------------
// Antbase smart routing handler
// ---------------------------------------------------------------------------

function handleAntbaseChat(
  conversationId: string,
  message: string,
  tenantId: string,
  model: string,
): Response {
  const setup = setupConversation(conversationId, message, tenantId);
  if (!setup) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { history, assistantMsgId, accumulated } = setup;
  const recentHistory = history.filter((m) => m.status !== "pending" && m.content !== "").slice(-20);
  const messages = recentHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return createPersistentStream(assistantMsgId, accumulated, ({ onChunk, onDone, onError }) => {
    const apiKey = process.env.ANTBASE_API_KEY;
    if (!apiKey) {
      onError("ANTBASE_API_KEY not set — add it in Settings → API Keys");
      return;
    }

    (async () => {
      try {
        const res = await fetch("https://antbase.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, max_tokens: 8192, messages, stream: true }),
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => `HTTP ${res.status}`);
          onError(`Antbase ${res.status}: ${text}`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) onChunk(content);
            } catch {}
          }
        }
        onDone();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// Generic runtime handler (fallback / configurable CoS path)
// ---------------------------------------------------------------------------

async function handleRuntimeChat(
  conversationId: string,
  message: string,
  deskId: string | undefined,
  tenantId: string,
  model?: string,
  runtimeId?: string,
): Promise<Response> {
  const setup = setupConversation(conversationId, message, tenantId);
  if (!setup) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { history, assistantMsgId, accumulated } = setup;

  const chiefOfStaff = db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.tenantId, tenantId),
        eq(agents.agentType, "chief_of_staff"),
        eq(agents.slug, "chief-of-staff"),
      ),
    )
    .get();

  let deskPersona: string | null = null;
  if (deskId) {
    const desk =
      db.select().from(desks).where(eq(desks.slug, deskId)).get() ||
      db.select().from(desks).where(eq(desks.id, deskId)).get();
    deskPersona = desk?.persona ?? null;
  }

  const briefing = await assembleBriefing();

  const recentHistory = history.filter((m) => m.status !== "pending" && m.content !== "").slice(-20);
  const historyBlock = recentHistory
    .map((m) => `${m.role === "user" ? "Operator" : "Co-Pilot"}: ${m.content}`)
    .join("\n\n");

  let wikiBlock = "";
  let docsBlock = "";
  const keywords = extractKeywords(message);

  if (deskId) {
    const desk =
      db.select().from(desks).where(eq(desks.slug, deskId)).get() ||
      db.select().from(desks).where(eq(desks.id, deskId)).get();
    if (desk) {
      const wikiEntries = queryWiki({ tenantId, deskId: desk.id, keywords, limit: 5 });
      wikiBlock = formatWikiForPrompt(wikiEntries);
    }
  }

  if (keywords.length > 0) {
    const recentDocs = db.select().from(documents).where(eq(documents.tenantId, tenantId)).all();
    const scored = recentDocs.map((doc) => {
      let score = 0;
      const titleLower = doc.title.toLowerCase();
      const contentLower = doc.content.toLowerCase();
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        if (titleLower.includes(kwLower)) score += 3;
        if (contentLower.includes(kwLower)) score += 1;
      }
      return { doc, score };
    });

    const topDocs = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
    if (topDocs.length > 0) {
      const docSections = topDocs.map((s) => {
        const content =
          s.doc.content.length > 3000 ? `${s.doc.content.slice(0, 3000)}\n\n[...truncated]` : s.doc.content;
        return `### ${s.doc.title}\n${content}`;
      });
      docsBlock = `## Relevant Documents\n\n${docSections.join("\n\n---\n\n")}`;
    }
  }

  const fullPrompt = [
    buildCopilotPrompt(deskPersona),
    "",
    "---",
    "",
    briefing.markdown,
    wikiBlock ? `\n${wikiBlock}\n` : "",
    docsBlock ? `\n${docsBlock}\n` : "",
    "",
    "---",
    "",
    "## Conversation",
    historyBlock,
    "",
    `Respond as the ${chiefOfStaff?.name || "Chief of Staff"}. Be concise, data-driven, and opinionated.`,
    "",
    "## Agent Coordination",
    "You have visibility into specialist agents (Steward, Scout, Outreach, etc.) via the Specialist Agent Activity section above.",
    "If you need a fresh update from a specific agent, include `[sync:DESK_SLUG]` in your response (e.g. `[sync:steward]` to get Steward's latest status).",
    "Available desk slugs: steward, scout, outreach, marketing, sales-engineering, chief-of-staff.",
  ].join("\n");

  const runtime = runtimeId ? getRuntimeById(runtimeId) || getRuntime() : getRuntime();
  const sandboxMode =
    runtime.id === "codex" && deskId === "chief-of-staff"
      ? getChiefOfStaffCodexSandboxMode()
      : undefined;

  return createPersistentStream(assistantMsgId, accumulated, ({ onChunk, onDone, onError }) => {
    runtime.stream(fullPrompt, {
      model: model ?? "claude-sonnet-4-6",
      sandboxMode,
    }, {
      onData: onChunk,
      onError,
      onClose: (code) => {
        if (code === 0) onDone();
        else onError(`Runtime closed with code ${code}`);
      },
    });
  });
}
