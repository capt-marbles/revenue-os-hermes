import { db } from "@/db";
import { agentRuns, agents, tasks, documents, agentSessionState } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ulid } from "ulid";
import { buildMcpConfigFile } from "@/lib/connectors/mcp-config";
import { getRuntime } from "@/lib/runtime";
import {
  queryWiki,
  getDeskForAgent,
  extractKeywords,
  formatWikiForPrompt,
} from "@/lib/agents/wiki-query";
import { ingestToWiki } from "@/lib/agents/wiki-ingestion";

interface StreamAgentParams {
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
  memory: {
    category: string;
    key: string;
    value: string;
  }[];
}

interface StreamCallbacks {
  onData: (text: string) => void;
  onStatus: (
    status: string,
    metadata?: Record<string, unknown>,
  ) => void;
  onDone: (result: {
    runId: string;
    status: string;
    durationMs: number;
    tokensUsed?: number;
    costEstimate?: number;
  }) => void;
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

function buildPrompt(params: StreamAgentParams): string {
  const sections: string[] = [];

  const icp = params.memory.find((m) => m.category === "icp");
  if (icp) sections.push(`## ICP\n${icp.value}`);

  const voice = params.memory.find((m) => m.category === "brand_voice");
  if (voice) sections.push(`## Brand Voice\n${voice.value}`);

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

  if (params.task) {
    sections.push(
      `## Task\nTitle: ${params.task.title}${params.task.description ? `\nDescription: ${params.task.description}` : ""}`,
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
      return parsed.filter(
        (t): t is string => typeof t === "string" && t.length > 0,
      );
    }
  } catch {
    return toolsJson
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

export function streamAgent(
  params: StreamAgentParams,
  callbacks: StreamCallbacks,
): void {
  const { runId, agent } = params;
  const startTime = Date.now();

  db.update(agentRuns)
    .set({ status: "running", startedAt: new Date().toISOString() })
    .where(eq(agentRuns.id, runId))
    .run();

  db.update(agents)
    .set({ status: "running" })
    .where(eq(agents.id, agent.id))
    .run();

  callbacks.onStatus("running", { agentName: agent.name });

  const prompt = buildPrompt(params);
  const model = agent.model || "sonnet";
  const tools = parseTools(agent.tools);
  const mcpConfigPath = buildMcpConfigFile();
  const runtime = getRuntime();

  let accumulated = "";
  let stderrAccumulated = "";

  runtime.stream(
    prompt,
    {
      model,
      tools,
      mcpConfigPath,
      maxTurns: 25,
      timeout: 300_000,
    },
    {
      onData: (text) => {
        accumulated += text;
        callbacks.onData(text);
      },
      onError: (error) => {
        stderrAccumulated += error;
        console.error(`[stream-executor] ${runId}:`, error);
      },
      onClose: (exitCode) => {
        const durationMs = Date.now() - startTime;
        const completedAt = new Date().toISOString();

        if (exitCode === 0 && accumulated) {
          let output: string;
          try {
            const parsed = JSON.parse(accumulated);
            output = JSON.stringify(parsed);
          } catch {
            output = JSON.stringify({ result: accumulated });
          }

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
              .set({ status: "done", updatedAt: completedAt })
              .where(eq(tasks.id, linkedTaskId))
              .run();
          }

          db.update(agentRuns)
            .set({
              status: "success",
              output,
              completedAt,
              durationMs,
              taskId: linkedTaskId,
            })
            .where(eq(agentRuns.id, runId))
            .run();

          let docContent = accumulated;
          try {
            const parsed = JSON.parse(output);
            docContent = parsed.result || parsed.content || accumulated;
          } catch {
            // Use raw accumulated
          }

          const docTitle = `${agent.name} — ${params.input.slice(0, 60)}${params.input.length > 60 ? "..." : ""}`;
          db.insert(documents)
            .values({
              id: ulid(),
              tenantId: params.tenantId,
              title: docTitle,
              content: docContent,
              summary:
                docContent.slice(0, 200) +
                (docContent.length > 200 ? "..." : ""),
              agentId: agent.id,
              agentRunId: runId,
              taskId: linkedTaskId,
              tags: JSON.stringify([agent.name]),
            })
            .run();

          // Session state for resumption
          const priorSession = loadSessionState(
            params.tenantId,
            agent.id,
            linkedTaskId,
          );
          saveSessionStateDirect(
            params.tenantId,
            agent.id,
            linkedTaskId,
            runId,
            "success",
            docContent,
            priorSession?.turnCount ?? 0,
          );

          ingestToWiki({
            tenantId: params.tenantId,
            runId,
            agentId: agent.id,
            documentContent: docContent,
          }).catch((err) => {
            console.error(`[Wiki Ingestion] Error for run ${runId}:`, err);
          });

          callbacks.onDone({
            runId,
            status: "success",
            durationMs,
          });
        } else {
          const partialOutput = accumulated
            ? JSON.stringify({ result: accumulated })
            : null;
          const errorDetail = stderrAccumulated.trim() || (accumulated ? "partial output above" : null);
          db.update(agentRuns)
            .set({
              status: "failed",
              output: partialOutput,
              error: errorDetail
                ? `Process exited with code ${exitCode}: ${errorDetail}`
                : `Process exited with code ${exitCode}`,
              completedAt,
              durationMs,
            })
            .where(eq(agentRuns.id, runId))
            .run();

          callbacks.onDone({
            runId,
            status: "failed",
            durationMs,
          });
        }

        db.update(agents)
          .set({ status: "idle" })
          .where(eq(agents.id, agent.id))
          .run();
      },
    },
  );
}

function saveSessionStateDirect(
  tenantId: string,
  agentId: string,
  taskId: string | null,
  runId: string,
  runStatus: string,
  output: string,
  previousTurnCount: number,
): void {
  if (!taskId) return;

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
    const combined =
      existing.sessionSummary.length + summary.length > 4000
        ? summary
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
