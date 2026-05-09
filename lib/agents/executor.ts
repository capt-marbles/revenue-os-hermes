import { db } from "@/db";
import { agentRuns, agents, tasks, documents, agentSessionState, documentReplies } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ulid } from "ulid";
import { buildMcpConfigFile } from "@/lib/connectors/mcp-config";
import { jobQueue } from "@/lib/queue/job-queue";
import { getRuntime } from "@/lib/runtime";
import { queryWiki, getDeskForAgent, extractKeywords, formatWikiForPrompt } from "@/lib/agents/wiki-query";
import { ingestToWiki } from "@/lib/agents/wiki-ingestion";
import { registerRun, unregisterRun } from "@/lib/agents/cancellation";

interface ExecuteAgentParams {
  runId: string;
  tenantId: string;
  agent: {
    id: string;
    name: string;
    systemPrompt: string | null;
    model: string | null;
    tools: string | null;
  };
  task: {
    title: string;
    description: string | null;
  } | null;
  taskId: string | null;
  input: string;
  timeoutSeconds?: number | null;
  memory: {
    category: string;
    key: string;
    value: string;
  }[];
}

function loadSessionState(
  tenantId: string,
  agentId: string,
  taskId: string | null,
): { sessionSummary: string; turnCount: number } | null {
  if (!taskId) return null;
  const state = db
    .select()
    .from(agentSessionState)
    .where(
      and(
        eq(agentSessionState.tenantId, tenantId),
        eq(agentSessionState.agentId, agentId),
        eq(agentSessionState.taskId, taskId),
      ),
    )
    .get();
  if (!state) return null;
  return { sessionSummary: state.sessionSummary, turnCount: state.turnCount };
}

function saveSessionState(
  tenantId: string,
  agentId: string,
  taskId: string | null,
  runId: string,
  runStatus: string,
  output: string,
  previousTurnCount: number,
): void {
  if (!taskId) return;

  // Compact: keep last 2000 chars of output as the session summary
  const maxLen = 2000;
  const summary =
    output.length > maxLen
      ? `[...earlier output truncated]\n\n${output.slice(-maxLen)}`
      : output;

  const existing = db
    .select()
    .from(agentSessionState)
    .where(
      and(
        eq(agentSessionState.tenantId, tenantId),
        eq(agentSessionState.agentId, agentId),
        eq(agentSessionState.taskId, taskId),
      ),
    )
    .get();

  const now = new Date().toISOString();
  const nextTurnCount = previousTurnCount + 1;

  if (existing) {
    // Append to existing summary — keep total under 4000 chars
    const combined =
      existing.sessionSummary.length + summary.length > 4000
        ? `${summary}`
        : `${existing.sessionSummary}\n\n---\n\n${summary}`;

    db.update(agentSessionState)
      .set({
        sessionSummary: combined,
        turnCount: nextTurnCount,
        lastRunId: runId,
        lastRunStatus: runStatus,
        updatedAt: now,
      })
      .where(eq(agentSessionState.id, existing.id))
      .run();
  } else {
    db.insert(agentSessionState)
      .values({
        id: ulid(),
        tenantId,
        agentId,
        taskId,
        sessionSummary: summary,
        turnCount: nextTurnCount,
        lastRunId: runId,
        lastRunStatus: runStatus,
      })
      .run();
  }
}

function buildPrompt(params: ExecuteAgentParams): string {
  const sections: string[] = [];

  const icp = params.memory.find((m) => m.category === "icp");
  if (icp) sections.push(`## ICP\n${icp.value}`);

  const voice = params.memory.find((m) => m.category === "brand_voice");
  if (voice) sections.push(`## Brand Voice\n${voice.value}`);

  // Inject relevant Director wiki entries for the agent's desk
  const deskId = getDeskForAgent(params.agent.id);
  if (deskId) {
    const keywords = extractKeywords(params.input);
    const wikiEntries = queryWiki({
      tenantId: params.tenantId,
      deskId,
      keywords,
      limit: 5,
    });
    const wikiBlock = formatWikiForPrompt(wikiEntries);
    if (wikiBlock) sections.push(wikiBlock);
  }

  // Inject session resumption context from prior runs on the same task
  const session = loadSessionState(
    params.tenantId,
    params.agent.id,
    params.taskId,
  );
  if (session) {
    sections.push(
      `## Prior Session Context (run #${session.turnCount})\n` +
        `The following is a summary of your previous work on this task. ` +
        `Use it to continue where you left off — do not repeat completed steps.\n\n` +
        session.sessionSummary,
    );
  }

  // Inject user replies from prior document outputs on this task
  if (params.taskId) {
    const taskDocs = db
      .select({ id: documents.id, createdAt: documents.createdAt })
      .from(documents)
      .where(and(eq(documents.taskId, params.taskId), eq(documents.tenantId, params.tenantId)))
      .all();

    const allReplies: { content: string; createdAt: string }[] = [];
    for (const d of taskDocs) {
      const replies = db
        .select({ content: documentReplies.content, createdAt: documentReplies.createdAt })
        .from(documentReplies)
        .where(eq(documentReplies.documentId, d.id))
        .all();
      allReplies.push(...replies);
    }

    if (allReplies.length > 0) {
      allReplies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const block = allReplies
        .map((r) => `[${new Date(r.createdAt).toLocaleDateString()}] ${r.content}`)
        .join("\n\n");
      sections.push(`## User Clarifications\nThe user has reviewed your previous output and provided the following context. Incorporate this into your work:\n\n${block}`);
    }
  }

  if (params.task) {
    sections.push(
      `## Task\nTitle: ${params.task.title}${params.task.description ? `\nDescription: ${params.task.description}` : ""}`
    );
  }

  sections.push(`## Instructions\n${params.input}`);

  const systemPrompt = params.agent.systemPrompt || "";
  const contextBlock = sections.join("\n\n");

  return `${systemPrompt}\n\n---\n\n${contextBlock}`;
}

function parseTools(toolsJson: string | null): string[] {
  if (!toolsJson) return [];
  try {
    const parsed = JSON.parse(toolsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string" && t.length > 0);
    }
  } catch {
    return toolsJson.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

export async function executeAgent(params: ExecuteAgentParams): Promise<void> {
  return jobQueue.submit(
    params.runId,
    `Agent: ${params.agent.name}`,
    () => executeAgentCore(params)
  );
}

async function executeAgentCore(params: ExecuteAgentParams): Promise<void> {
  const { runId, agent } = params;
  const startTime = Date.now();
  const abortController = registerRun(runId);

  db.update(agentRuns)
    .set({ status: "running", startedAt: new Date().toISOString() })
    .where(eq(agentRuns.id, runId))
    .run();

  db.update(agents)
    .set({ status: "running" })
    .where(eq(agents.id, agent.id))
    .run();

  console.log(JSON.stringify({ event: "agent_run_start", agentId: agent.id, agentName: agent.name, runId, timestamp: new Date().toISOString() }));

  // Tag the run with the active pipeline config for attribution
  const { getActivePipelineConfig: getActivePipeline, resolvePipelineConfigForOpportunity } = await import("@/lib/pipeline/config");
  const activePipeline = resolvePipelineConfigForOpportunity(runId, params.tenantId);
  db.update(agentRuns)
    .set({ pipelineConfigId: activePipeline.id })
    .where(eq(agentRuns.id, runId))
    .run();

  const prompt = buildPrompt(params);
  const model = agent.model || "sonnet";
  const tools = parseTools(agent.tools);
  const mcpConfigPath = buildMcpConfigFile();

  // Execute via the runtime abstraction
  const runtime = getRuntime();
  const result = await runtime.execute(prompt, {
    model,
    tools,
    mcpConfigPath,
    maxTurns: 25,
    timeout: (params.timeoutSeconds ?? 300) * 1000,
    signal: abortController.signal,
  });

  const durationMs = Date.now() - startTime;
  const completedAt = new Date().toISOString();

  if (result.exitCode === 0) {
    let output = result.stdout;
    try {
      const parsed = JSON.parse(result.stdout);
      output = JSON.stringify(parsed);
    } catch {
      output = JSON.stringify({ result: result.stdout });
    }

    // Auto-create task if not linked to one
    let linkedTaskId = params.taskId;
    if (!linkedTaskId) {
      const taskTitle = `${agent.name}: ${params.input.slice(0, 80)}${params.input.length > 80 ? "..." : ""}`;
      linkedTaskId = ulid();
      db.insert(tasks)
        .values({
          id: linkedTaskId,
          tenantId: params.tenantId,
          title: taskTitle,
          description: params.input,
          status: "done",
          assigneeType: "agent",
          assigneeId: agent.id,
          priority: "medium",
          position: 0,
        })
        .run();
    } else {
      db.update(tasks)
        .set({ status: "done", updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, linkedTaskId))
        .run();
    }

    db.update(agentRuns)
      .set({
        status: "success",
        output,
        completedAt,
        durationMs,
        tokensUsed: result.tokensUsed,
        costEstimate: result.costEstimate,
        taskId: linkedTaskId,
      })
      .where(eq(agentRuns.id, runId))
      .run();

    console.log(JSON.stringify({ event: "agent_run_complete", agentId: agent.id, runId, status: "success", durationMs, runtime: runtime.id, timestamp: new Date().toISOString() }));

    let docContent = result.stdout;
    try {
      const parsed = JSON.parse(output);
      docContent = parsed.result || parsed.content || result.stdout;
    } catch {
      // Use raw stdout
    }

    const docTitle = `${agent.name} — ${params.input.slice(0, 60)}${params.input.length > 60 ? "..." : ""}`;
    const summary = docContent.slice(0, 200) + (docContent.length > 200 ? "..." : "");
    db.insert(documents)
      .values({
        id: ulid(),
        tenantId: params.tenantId,
        title: docTitle,
        content: docContent,
        summary,
        agentId: agent.id,
        agentRunId: runId,
        taskId: linkedTaskId,
        tags: JSON.stringify([agent.name]),
      })
      .run();

    // Persist session state for resumption on subsequent runs
    const priorSession = loadSessionState(params.tenantId, agent.id, linkedTaskId);
    saveSessionState(
      params.tenantId,
      agent.id,
      linkedTaskId,
      runId,
      "success",
      docContent,
      priorSession?.turnCount ?? 0,
    );

    // Post-run wiki ingestion — fire and forget
    ingestToWiki({
      tenantId: params.tenantId,
      runId,
      agentId: agent.id,
      documentContent: docContent,
    }).catch((err) => {
      console.error(`[Wiki Ingestion] Error for run ${runId}:`, err);
    });
  } else {
    // With --output-format json, the CLI may write error details to stdout (as JSON) not stderr
    let errorDetail = result.stderr?.trim();
    if (!errorDetail && result.stdout?.trim()) {
      try {
        const parsed = JSON.parse(result.stdout);
        errorDetail = parsed.error || parsed.message || parsed.result || result.stdout.slice(0, 500);
      } catch {
        errorDetail = result.stdout.slice(0, 500);
      }
    }
    const errorMsg = errorDetail
      ? `Process exited with code ${result.exitCode}: ${errorDetail}`
      : `Process exited with code ${result.exitCode}`;

    db.update(agentRuns)
      .set({
        status: "failed",
        output: result.stdout ? JSON.stringify({ result: result.stdout }) : null,
        error: errorMsg,
        completedAt,
        durationMs,
      })
      .where(eq(agentRuns.id, runId))
      .run();

    console.log(JSON.stringify({ event: "agent_run_failed", agentId: agent.id, runId, status: "failed", durationMs, runtime: runtime.id, error: errorMsg.slice(0, 500), timestamp: new Date().toISOString() }));

    // Persist failure context so the next run knows what went wrong
    if (params.taskId) {
      const priorSession = loadSessionState(params.tenantId, agent.id, params.taskId);
      saveSessionState(
        params.tenantId,
        agent.id,
        params.taskId,
        runId,
        "failed",
        `[Run failed] ${result.stderr?.slice(0, 500) || "Unknown error"}`,
        priorSession?.turnCount ?? 0,
      );
    }
  }

  db.update(agents)
    .set({ status: "idle" })
    .where(eq(agents.id, agent.id))
    .run();

  unregisterRun(runId);
}
