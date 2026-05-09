import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { db } from "@/db";
import { goals, tasks, sharedMemory } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { ulid } from "ulid";


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantId();

  const goal = db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
    .get();

  if (!goal) {
    return Response.json({ error: "Goal not found" }, { status: 404 });
  }

  // Get existing tasks for this goal to avoid duplicates
  const existingTasks = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.goalId, id), eq(tasks.tenantId, tenantId)))
    .all();

  // Get ICP and competitors for context
  const memory = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  const icp = memory.find((m) => m.category === "icp")?.value || "";
  const competitors = memory.find((m) => m.category === "competitors")?.value || "";

  const existingTaskList = existingTasks.length > 0
    ? `\n\nExisting tasks for this goal (do NOT duplicate these):\n${existingTasks.map((t) => `- ${t.title}`).join("\n")}`
    : "";

  const prompt = `You are a strategic task planner for Gameye, a B2B game server hosting platform.

Decompose this goal into 5-8 concrete, actionable tasks. Each task should be specific enough that an AI agent or human can execute it.

## Goal
Title: ${goal.title}
Description: ${goal.description || "No description"}
Target: ${goal.targetValue} ${goal.unit || ""}
Deadline: ${goal.deadline || "No deadline"}

## Context
${icp ? `### ICP\n${icp}\n` : ""}
${competitors ? `### Competitors\n${competitors}\n` : ""}
${existingTaskList}

## Output Format
Return ONLY a JSON array of task objects. No markdown, no explanation, just the JSON array:
[
  {"title": "task title", "description": "what to do", "priority": "high|medium|low"},
  ...
]

Be specific to Gameye and the game server hosting industry. Each task should move the needle on the goal.`;

  // Execute claude to generate tasks
  return new Promise<Response>((resolve) => {
    const proc = spawn("claude", ["-p", "-", "--model", "sonnet", "--output-format", "json", "--max-turns", "3", "--dangerously-skip-permissions"], {
      timeout: 120000,
      env: { ...process.env },
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(Response.json({ error: stderr || "Agent failed" }, { status: 500 }));
        return;
      }

      // Parse the claude output — it's JSON wrapped in the --output-format json envelope
      let taskList: Array<{ title: string; description: string; priority: string }> = [];
      try {
        const envelope = JSON.parse(stdout);
        const result = envelope.result || stdout;

        // Try to extract JSON array from the result
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          taskList = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON array found in output");
        }
      } catch {
        // Try parsing stdout directly as JSON array
        try {
          const jsonMatch = stdout.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            taskList = JSON.parse(jsonMatch[0]);
          } else {
            resolve(Response.json({ error: "Could not parse task list from agent output" }, { status: 500 }));
            return;
          }
        } catch {
          resolve(Response.json({ error: "Could not parse task list from agent output" }, { status: 500 }));
          return;
        }
      }

      // Validate and create tasks
      const created: string[] = [];
      let position = existingTasks.length;

      for (const item of taskList) {
        if (!item.title) continue;

        const priority = ["low", "medium", "high", "urgent"].includes(item.priority?.toLowerCase())
          ? item.priority.toLowerCase()
          : "medium";

        const taskId = ulid();
        db.insert(tasks)
          .values({
            id: taskId,
            tenantId,
            goalId: id,
            title: item.title,
            description: item.description || "",
            status: "todo",
            priority,
            position: position++,
            assigneeType: "unassigned",
          })
          .run();

        created.push(item.title);
      }

      resolve(Response.json({ created, count: created.length }));
    });

    proc.on("error", (err) => {
      resolve(Response.json({ error: err.message }, { status: 500 }));
    });
  });
}
