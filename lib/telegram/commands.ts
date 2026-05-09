import { db } from "@/db";
import { agents, goals, tasks, sequences, agentRuns, sharedMemory } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";
import { assembleBriefing } from "@/lib/agents/copilot-briefing";
import { executeAgent } from "@/lib/agents/executor";
import { executeSequence } from "@/lib/agents/sequence-executor";

export async function handleCommand(command: string, args: string): Promise<string> {
  switch (command) {
    case "/status":
      return handleStatus();
    case "/goals":
      return handleGoals();
    case "/agents":
      return handleAgents();
    case "/run":
      return handleRun(args);
    case "/sequence":
      return handleSequence(args);
    case "/help":
    case "/start":
      return handleHelp();
    default:
      return `Unknown command: ${command}\nType /help for available commands.`;
  }
}

async function handleStatus(): Promise<string> {
  const briefing = await assembleBriefing();
  const { goals: goalList, taskDistribution, totals } = briefing.structured;

  const lines: string[] = [];
  lines.push("== STATUS ==\n");

  // Goals
  lines.push("GOALS:");
  for (const g of goalList) {
    const bar = progressBar(g.progress, 10);
    lines.push(`  ${bar} ${g.progress}% ${g.title}`);
  }

  // Tasks
  lines.push("\nTASKS:");
  const totalTasks = Object.values(taskDistribution).reduce((s, n) => s + n, 0);
  for (const [status, count] of Object.entries(taskDistribution)) {
    lines.push(`  ${status}: ${count}`);
  }
  lines.push(`  Total: ${totalTasks}`);

  // Agent performance
  if (totals.totalRuns7d > 0) {
    lines.push(`\nAGENTS (7d):`);
    lines.push(`  Runs: ${totals.totalRuns7d} | Success: ${totals.successRate}%`);
    lines.push(`  Cost: $${totals.totalCost.toFixed(2)} | Avg: ${(totals.avgDuration / 1000).toFixed(1)}s`);
  }

  return lines.join("\n");
}

async function handleGoals(): Promise<string> {
  const tenantId = getTenantId();
  const allGoals = db.select().from(goals).where(eq(goals.tenantId, tenantId)).all();

  if (allGoals.length === 0) return "No goals defined.";

  const lines: string[] = ["== GOALS ==\n"];

  for (const g of allGoals) {
    const progress = g.targetValue && g.currentValue
      ? Math.round((g.currentValue / g.targetValue) * 100)
      : 0;
    const bar = progressBar(progress, 10);
    const target = g.unit === "usd"
      ? `$${g.targetValue?.toLocaleString() ?? 0}`
      : `${g.targetValue ?? "?"} ${g.unit ?? ""}`;

    lines.push(`${bar} ${progress}%`);
    lines.push(`  ${g.title}`);
    lines.push(`  Target: ${target} | Status: ${g.status}`);
    if (g.deadline) lines.push(`  Deadline: ${g.deadline}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function handleAgents(): Promise<string> {
  const tenantId = getTenantId();
  const allAgents = db
    .select()
    .from(agents)
    .where(eq(agents.tenantId, tenantId))
    .all();

  const lines: string[] = [`== AGENTS (${allAgents.length} total) ==\n`];

  // Show top 20 by source
  const bySource = new Map<string, typeof allAgents>();
  for (const a of allAgents) {
    const group = bySource.get(a.source) || [];
    group.push(a);
    bySource.set(a.source, group);
  }

  for (const [source, list] of bySource) {
    lines.push(`${source} (${list.length}):`);
    for (const a of list.slice(0, 10)) {
      const status = a.status === "running" ? " [RUNNING]" : "";
      lines.push(`  - ${a.name}${status}`);
    }
    if (list.length > 10) lines.push(`  ... and ${list.length - 10} more`);
    lines.push("");
  }

  lines.push("Use: /run <agent name> <prompt>");
  return lines.join("\n");
}

async function handleRun(args: string): Promise<string> {
  if (!args.trim()) return "Usage: /run <agent name> <prompt>\nExample: /run SEO Specialist audit gameye.com";

  const tenantId = getTenantId();

  // Split args: first try to match agent name, rest is prompt
  const allAgents = db.select().from(agents).where(eq(agents.tenantId, tenantId)).all();

  // Try longest match first
  let matchedAgent: typeof allAgents[0] | null = null;
  let prompt = "";

  for (const agent of allAgents.sort((a, b) => b.name.length - a.name.length)) {
    if (args.toLowerCase().startsWith(agent.name.toLowerCase())) {
      matchedAgent = agent;
      prompt = args.slice(agent.name.length).trim();
      break;
    }
    if (args.toLowerCase().startsWith(agent.slug.toLowerCase())) {
      matchedAgent = agent;
      prompt = args.slice(agent.slug.length).trim();
      break;
    }
  }

  // Fallback: fuzzy match on first few words
  if (!matchedAgent) {
    const words = args.split(" ");
    for (let i = Math.min(words.length, 4); i >= 1; i--) {
      const candidate = words.slice(0, i).join(" ").toLowerCase();
      const match = allAgents.find(
        (a) =>
          a.name.toLowerCase().includes(candidate) ||
          a.slug.toLowerCase().includes(candidate)
      );
      if (match) {
        matchedAgent = match;
        prompt = words.slice(i).join(" ");
        break;
      }
    }
  }

  if (!matchedAgent) return `Could not find an agent matching "${args.split(" ").slice(0, 3).join(" ")}"\nType /agents to see available agents.`;
  if (!prompt) return `Please provide a prompt after the agent name.\nExample: /run ${matchedAgent.name} audit gameye.com`;

  // Trigger the run
  const memory = db.select().from(sharedMemory).where(eq(sharedMemory.tenantId, tenantId)).all();
  const runId = ulid();

  db.insert(agentRuns)
    .values({
      id: runId,
      tenantId,
      agentId: matchedAgent.id,
      status: "queued",
      trigger: "manual",
      input: JSON.stringify({ input: prompt, source: "telegram" }),
    })
    .run();

  executeAgent({
    runId,
    tenantId,
    agent: {
      id: matchedAgent.id,
      name: matchedAgent.name,
      systemPrompt: matchedAgent.systemPrompt,
      model: matchedAgent.model,
      tools: matchedAgent.tools,
    },
    task: null,
    taskId: null,
    input: prompt,
    memory,
  }).catch((err) => {
    console.error(`Telegram agent run failed:`, err);
  });

  return `Agent "${matchedAgent.name}" triggered.\nPrompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}\nCheck /status or the Activity tab for results.`;
}

async function handleSequence(args: string): Promise<string> {
  if (!args.trim()) return "Usage: /sequence <name> <input>\nExample: /sequence Outbound Prospecting Find 10 game studio CTOs";

  const tenantId = getTenantId();
  const allSequences = db.select().from(sequences).where(eq(sequences.tenantId, tenantId)).all();

  if (allSequences.length === 0) return "No sequences configured. Create one in the Sequences tab.";

  // Match sequence name
  let matched: typeof allSequences[0] | null = null;
  let input = "";

  for (const p of allSequences.sort((a, b) => b.name.length - a.name.length)) {
    if (args.toLowerCase().startsWith(p.name.toLowerCase())) {
      matched = p;
      input = args.slice(p.name.length).trim();
      break;
    }
  }

  if (!matched) {
    const names = allSequences.map((p) => `  - ${p.name}`).join("\n");
    return `Could not find a sequence matching that name.\nAvailable sequences:\n${names}`;
  }
  if (!input) return `Please provide input for the sequence.\nExample: /sequence ${matched.name} Find 10 game studio CTOs`;

  executeSequence({ sequenceId: matched.id, input }).catch((err) => {
    console.error(`Telegram sequence run failed:`, err);
  });

  return `Sequence "${matched.name}" started.\nInput: ${input.slice(0, 100)}${input.length > 100 ? "..." : ""}\nCheck the Activity tab for progress.`;
}

function handleHelp(): string {
  return [
    "== Revenue OS Bot ==\n",
    "Commands:",
    "  /status   - Goal progress, task distribution, agent performance",
    "  /goals    - Detailed goal list with progress bars",
    "  /agents   - List available agents",
    "  /run <agent> <prompt> - Trigger an agent run",
    "  /sequence <name> <input> - Run a sequence",
    "  /help     - Show this message",
    "",
    "Or just send a message to chat with the Co-Pilot.",
  ].join("\n");
}

function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "[" + "=".repeat(filled) + " ".repeat(empty) + "]";
}
