import { db } from "@/db";
import { goals, tasks, agents, agentRuns, sharedMemory, outreachSends, outreachTemplates, outreachResponses, documents, copilotConversations, copilotMessages, copilotActionDecisions, desks, auditLog } from "@/db/schema";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";

export interface BriefingData {
  markdown: string;
  structured: {
    goals: GoalSummary[];
    taskDistribution: Record<string, number>;
    agentPerformance: AgentPerf[];
    recentRuns: RecentRun[];
    memoryCategories: { category: string; count: number }[];
    agentDigests: AgentDigest[];
    pendingDecisions: PendingDecision[];
    totals: {
      totalRuns7d: number;
      successRate: number;
      totalCost: number;
      avgDuration: number;
    };
  };
}

interface AgentDigest {
  deskName: string;
  deskSlug: string;
  conversationId: string;
  lastActivity: string;
  messageCount: number;
  lastAssistantMessage: string | null;
}

interface PendingDecision {
  deskName: string;
  conversationId: string;
  actionKey: string;
  title: string;
  createdAt: string;
}

interface GoalSummary {
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
}

interface AgentPerf {
  agentId: string;
  agentName: string;
  runs: number;
  successes: number;
  successRate: number;
  totalCost: number;
  avgDuration: number;
}

interface RecentRun {
  agentName: string;
  status: string;
  durationMs: number | null;
  costEstimate: number | null;
  taskTitle: string | null;
  createdAt: string;
}

function formatCurrency(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function assembleBriefing(opts?: { includeAgentDigests?: boolean }): Promise<BriefingData> {
  const includeAgentDigests = opts?.includeAgentDigests ?? true;
  const tenantId = getTenantId();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Goals + task counts
  const allGoals = db.select().from(goals).where(eq(goals.tenantId, tenantId)).all();
  const tasksByGoal = db
    .select({
      goalId: tasks.goalId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
    })
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .groupBy(tasks.goalId)
    .all();

  const goalTaskMap = new Map(tasksByGoal.map((t) => [t.goalId, { total: t.total, done: t.done }]));

  const goalSummaries: GoalSummary[] = allGoals.map((g) => {
    const tc = goalTaskMap.get(g.id);
    const progress =
      g.targetValue && g.currentValue
        ? Math.round((g.currentValue / g.targetValue) * 100)
        : tc
          ? tc.total > 0
            ? Math.round((tc.done / tc.total) * 100)
            : 0
          : 0;

    return {
      id: g.id,
      title: g.title,
      status: g.status,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      unit: g.unit,
      deadline: g.deadline,
      taskCount: tc?.total ?? 0,
      tasksDone: tc?.done ?? 0,
      progress,
    };
  });

  // 2. Task distribution
  const taskDist = db
    .select({
      status: tasks.status,
      count: sql<number>`count(*)`,
    })
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .groupBy(tasks.status)
    .all();

  const taskDistribution: Record<string, number> = {};
  for (const t of taskDist) {
    taskDistribution[t.status] = t.count;
  }

  const assigneeDist = db
    .select({
      assigneeType: tasks.assigneeType,
      count: sql<number>`count(*)`,
    })
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .groupBy(tasks.assigneeType)
    .all();

  // 3. Agent performance (last 7 days)
  const runsByAgent = db
    .select({
      agentId: agentRuns.agentId,
      agentName: agents.name,
      runs: sql<number>`count(*)`,
      successes: sql<number>`sum(case when ${agentRuns.status} = 'success' then 1 else 0 end)`,
      totalCost: sql<number>`coalesce(sum(${agentRuns.costEstimate}), 0)`,
      avgDuration: sql<number>`coalesce(avg(${agentRuns.durationMs}), 0)`,
    })
    .from(agentRuns)
    .leftJoin(agents, eq(agentRuns.agentId, agents.id))
    .where(
      and(
        eq(agentRuns.tenantId, tenantId),
        gte(agentRuns.createdAt, sevenDaysAgo)
      )
    )
    .groupBy(agentRuns.agentId)
    .all();

  const agentPerformance: AgentPerf[] = runsByAgent
    .map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName || "Unknown",
      runs: r.runs,
      successes: r.successes,
      successRate: r.runs > 0 ? Math.round((r.successes / r.runs) * 100) : 0,
      totalCost: r.totalCost,
      avgDuration: r.avgDuration,
    }))
    .sort((a, b) => b.runs - a.runs);

  // Totals
  const totalRuns7d = agentPerformance.reduce((s, a) => s + a.runs, 0);
  const totalSuccesses = agentPerformance.reduce((s, a) => s + a.successes, 0);
  const totalCost = agentPerformance.reduce((s, a) => s + a.totalCost, 0);
  const avgDuration =
    totalRuns7d > 0
      ? agentPerformance.reduce((s, a) => s + a.avgDuration * a.runs, 0) / totalRuns7d
      : 0;
  const successRate = totalRuns7d > 0 ? Math.round((totalSuccesses / totalRuns7d) * 100) : 0;

  // 4. Shared memory categories
  const memCats = db
    .select({
      category: sharedMemory.category,
      count: sql<number>`count(*)`,
    })
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .groupBy(sharedMemory.category)
    .all();

  // 5. Outreach stats (last 7 days)
  const outreachStats = db
    .select({
      totalSends: sql<number>`count(distinct ${outreachSends.id})`,
      totalReplies: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'reply' then ${outreachResponses.id} end)`,
      totalBounces: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'bounce' then ${outreachResponses.id} end)`,
      totalMeetings: sql<number>`count(distinct case when ${outreachResponses.responseType} = 'meeting_booked' then ${outreachResponses.id} end)`,
    })
    .from(outreachSends)
    .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
    .where(
      and(
        eq(outreachSends.tenantId, tenantId),
        gte(outreachSends.sentAt, sevenDaysAgo)
      )
    )
    .get();

  // 5.5 Recent task events (status changes, creates, deletes)
  const recentTaskEvents = db
    .select({
      action: auditLog.action,
      summary: auditLog.summary,
      createdAt: auditLog.createdAt,
      source: auditLog.source,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, tenantId),
        sql`${auditLog.entity} = 'task'`,
        gte(auditLog.createdAt, sevenDaysAgo),
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(15)
    .all();

  // 6. Recent 5 runs
  const recent = db
    .select({
      agentName: agents.name,
      status: agentRuns.status,
      durationMs: agentRuns.durationMs,
      costEstimate: agentRuns.costEstimate,
      taskId: agentRuns.taskId,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .leftJoin(agents, eq(agentRuns.agentId, agents.id))
    .where(eq(agentRuns.tenantId, tenantId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(5)
    .all();

  // Batch-load task titles to avoid N+1 queries
  const taskIds = recent.map((r) => r.taskId).filter((id): id is string => !!id);
  const taskTitleMap = new Map<string, string>();
  if (taskIds.length > 0) {
    const taskRows = db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .all();
    for (const t of taskRows) {
      if (taskIds.includes(t.id)) taskTitleMap.set(t.id, t.title);
    }
  }

  const recentRuns: RecentRun[] = recent.map((r) => ({
    agentName: r.agentName || "Unknown",
    status: r.status,
    durationMs: r.durationMs,
    costEstimate: r.costEstimate,
    taskTitle: r.taskId ? (taskTitleMap.get(r.taskId) ?? null) : null,
    createdAt: r.createdAt,
  }));

  // 7. Agent digests — latest activity from each desk (Steward, Scout, Outreach, etc.)
  const activeDesks = db
    .select({ id: desks.id, name: desks.name, slug: desks.slug })
    .from(desks)
    .where(eq(desks.tenantId, tenantId))
    .all();

  const agentDigests: AgentDigest[] = [];
  for (const desk of activeDesks) {
    const latestConvo = db
      .select({ id: copilotConversations.id })
      .from(copilotConversations)
      .where(
        and(
          eq(copilotConversations.tenantId, tenantId),
          eq(copilotConversations.deskId, desk.id),
        )
      )
      .orderBy(desc(copilotConversations.updatedAt))
      .limit(1)
      .get();

    if (!latestConvo) continue;

    const msgCount = db
      .select({ count: sql<number>`count(*)` })
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, latestConvo.id))
      .get()?.count ?? 0;

    if (msgCount === 0) continue;

    const lastMsg = db
      .select({ content: copilotMessages.content, createdAt: copilotMessages.createdAt })
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, latestConvo.id))
      .orderBy(desc(copilotMessages.createdAt))
      .limit(1)
      .get();

    agentDigests.push({
      deskName: desk.name,
      deskSlug: desk.slug,
      conversationId: latestConvo.id,
      lastActivity: lastMsg?.createdAt ?? "",
      messageCount: msgCount,
      lastAssistantMessage: lastMsg?.content?.slice(0, 800) ?? null,
    });
  }

  agentDigests.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  // 8. Pending action decisions across all desks
  const pendingDecisions = db
      .select({
        actionKey: copilotActionDecisions.actionKey,
        resultMessage: copilotActionDecisions.resultMessage,
        createdAt: copilotActionDecisions.createdAt,
        convoId: copilotActionDecisions.conversationId,
      })
      .from(copilotActionDecisions)
      .where(eq(copilotActionDecisions.tenantId, tenantId))
      .orderBy(desc(copilotActionDecisions.createdAt))
      .limit(10)
      .all();

  const pendingDecisionsFormatted: PendingDecision[] = pendingDecisions
    .map((pd) => {
      // Look up desk name for this conversation
      const convo = db
        .select({ deskId: copilotConversations.deskId })
        .from(copilotConversations)
        .where(eq(copilotConversations.id, pd.convoId))
        .get();
      const desk = convo?.deskId ? activeDesks.find((d) => d.id === convo.deskId) : null;
      // Parse a title from the action key or result message
      const title = pd.resultMessage?.slice(0, 100) ?? pd.actionKey;
      return {
        deskName: desk?.name ?? "Global",
        conversationId: pd.convoId,
        actionKey: pd.actionKey,
        title,
        createdAt: pd.createdAt,
      };
    });

  // ─── Build markdown briefing ────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`## System Briefing — ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`);
  lines.push("");

  // Goals
  lines.push("### Goals");
  if (goalSummaries.length === 0) {
    lines.push("No goals defined.");
  } else {
    lines.push("| Goal | Progress | Target | Deadline | Tasks |");
    lines.push("|------|----------|--------|----------|-------|");
    for (const g of goalSummaries) {
      const target = g.unit === "usd"
        ? `$${g.targetValue?.toLocaleString() ?? "—"}`
        : g.unit === "position"
          ? `#${g.targetValue ?? "—"}`
          : `${g.targetValue ?? "—"} ${g.unit ?? ""}`;
      const current = g.unit === "usd"
        ? `$${g.currentValue?.toLocaleString() ?? "0"}`
        : g.unit === "position"
          ? (g.currentValue ? `#${g.currentValue}` : "—")
          : `${g.currentValue ?? 0}`;
      const deadline = g.deadline
        ? new Date(g.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "No deadline";
      lines.push(`| ${g.title} | ${current} / ${target} (${g.progress}%) | ${target} | ${deadline} | ${g.tasksDone}/${g.taskCount} done |`);
    }
  }
  lines.push("");

  // Task distribution
  lines.push("### Task Distribution");
  const totalTasks = Object.values(taskDistribution).reduce((s, n) => s + n, 0);
  lines.push(`Total: ${totalTasks} tasks`);
  for (const [status, count] of Object.entries(taskDistribution)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push("");
  lines.push("Assignment:");
  for (const a of assigneeDist) {
    lines.push(`- ${a.assigneeType}: ${a.count}`);
  }

  // Recent task events
  if (recentTaskEvents.length > 0) {
    lines.push("");
    lines.push("#### Recent Task Activity");
    for (const evt of recentTaskEvents.slice(0, 8)) {
      const when = evt.createdAt
        ? new Date(evt.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "";
      const icon = evt.action === "task.status_changed" ? "↔️"
        : evt.action === "task.created" ? "➕"
        : evt.action === "task.deleted" ? "🗑️"
        : "📝";
      lines.push(`- ${icon} ${evt.summary} (${when})`);
    }
  }

  lines.push("");

  // Agent performance
  lines.push("### Agent Performance (last 7 days)");
  if (totalRuns7d === 0) {
    lines.push("No agent runs in the last 7 days.");
  } else {
    lines.push(`- Total runs: ${totalRuns7d} | Success rate: ${successRate}% | Cost: ${formatCurrency(totalCost)} | Avg duration: ${formatDuration(avgDuration)}`);
    lines.push("");
    if (agentPerformance.length > 0) {
      const top = agentPerformance.filter((a) => a.runs >= 2).slice(0, 5);
      if (top.length > 0) {
        lines.push("Top agents:");
        for (const a of top) {
          lines.push(`- ${a.agentName}: ${a.runs} runs, ${a.successRate}% success, ${formatCurrency(a.totalCost)}, avg ${formatDuration(a.avgDuration)}`);
        }
      }
      const struggling = agentPerformance.filter((a) => a.successRate < 70 && a.runs >= 2);
      if (struggling.length > 0) {
        lines.push("");
        lines.push("Struggling agents:");
        for (const a of struggling) {
          lines.push(`- ${a.agentName}: ${a.runs} runs, ${a.successRate}% success`);
        }
      }
    }
  }
  lines.push("");

  // Memory summary
  lines.push("### Shared Memory");
  for (const mc of memCats) {
    lines.push(`- ${mc.category}: ${mc.count} entries`);
  }
  lines.push("");

  // Outreach
  if (outreachStats && outreachStats.totalSends > 0) {
    const replyRate = Math.round((outreachStats.totalReplies / outreachStats.totalSends) * 100);
    lines.push("### Outreach (last 7 days)");
    lines.push(`- Sends: ${outreachStats.totalSends} | Replies: ${outreachStats.totalReplies} (${replyRate}%) | Bounces: ${outreachStats.totalBounces} | Meetings: ${outreachStats.totalMeetings}`);
    lines.push("");
  }

  // Recent activity
  if (recentRuns.length > 0) {
    lines.push("### Recent Activity");
    for (const r of recentRuns) {
      const dur = r.durationMs ? formatDuration(r.durationMs) : "—";
      const cost = r.costEstimate ? formatCurrency(r.costEstimate) : "—";
      const task = r.taskTitle ? ` — Task: "${r.taskTitle}"` : "";
      lines.push(`- ${r.agentName}: ${r.status.toUpperCase()} (${dur}, ${cost})${task}`);
    }
  }

  // Recent documents (last 3 — summaries only, to give Director visibility into outputs)
  const recentDocs = db
    .select({
      title: documents.title,
      summary: documents.summary,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.tenantId, tenantId))
    .orderBy(desc(documents.createdAt))
    .limit(3)
    .all();

  if (recentDocs.length > 0) {
    lines.push("");
    lines.push("### Recent Documents");
    for (const doc of recentDocs) {
      const summary = doc.summary ? ` — ${doc.summary.slice(0, 120)}` : "";
      lines.push(`- ${doc.title}${summary}`);
    }
  }

  // Agent digests — what each desk agent has been doing
  // Omitted when includeAgentDigests=false (e.g. agentic CoS uses get_agent_activity tool instead)
  if (includeAgentDigests && agentDigests.length > 0) {
    lines.push("");
    lines.push("### Specialist Agent Activity");
    lines.push("The following agents are active. Use their latest outputs to stay informed:");
    lines.push("");
    for (const ad of agentDigests) {
      const when = ad.lastActivity
        ? new Date(ad.lastActivity).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "No activity";
      lines.push(`#### ${ad.deskName} (${ad.messageCount} messages, last: ${when})`);
      if (ad.lastAssistantMessage) {
        const msg = ad.lastAssistantMessage.length > 600
          ? ad.lastAssistantMessage.slice(0, 600) + "\n...[truncated]"
          : ad.lastAssistantMessage;
        lines.push(msg);
      }
      lines.push("");
    }
  } else if (agentDigests.length > 0) {
    lines.push("");
    lines.push("### Specialist Agents");
    for (const ad of agentDigests) {
      const when = ad.lastActivity
        ? new Date(ad.lastActivity).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "No activity";
      lines.push(`- ${ad.deskName}: ${ad.messageCount} messages, last active ${when}`);
    }
  }

  // Pending decisions
  if (pendingDecisionsFormatted.length > 0) {
    lines.push("");
    lines.push("### Pending Action Decisions");
    for (const pd of pendingDecisionsFormatted) {
      const when = new Date(pd.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      lines.push(`- [${pd.deskName}] ${pd.title} (${when})`);
    }
  }

  return {
    markdown: lines.join("\n"),
    structured: {
      goals: goalSummaries,
      taskDistribution,
      agentPerformance,
      recentRuns,
      memoryCategories: memCats,
      agentDigests,
      pendingDecisions: pendingDecisionsFormatted,
      totals: { totalRuns7d, successRate, totalCost, avgDuration },
    },
  };
}
