import { db } from "@/db";
import {
  sequences,
  sequenceSteps,
  sequenceRuns,
  agents,
  agentRuns,
  tasks,
  documents,
  sharedMemory,
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { ulid } from "ulid";
import { executeAgent } from "./executor";
import { getTenantId } from "@/lib/tenant";

interface SequenceRunParams {
  sequenceId: string;
  input: string;
}

/**
 * Execute a sequence with support for parallel groups.
 *
 * Steps are organized by `group` number. Steps in the same group run in parallel.
 * Groups execute sequentially — group 1 waits for all group 0 steps to finish.
 *
 * Each parallel step receives the combined output of all steps from the previous group.
 * {{previous_output}} contains the merged outputs, {{sequence_input}} is the original input.
 */
export async function executeSequence(params: SequenceRunParams): Promise<string> {
  const tenantId = getTenantId();
  const { sequenceId, input } = params;

  const sequence = db
    .select()
    .from(sequences)
    .where(eq(sequences.id, sequenceId))
    .get();

  if (!sequence) throw new Error("Sequence not found");

  const steps = db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(sequenceSteps.group), asc(sequenceSteps.position))
    .all();

  if (steps.length === 0) throw new Error("Sequence has no steps");

  // Create parent task
  const parentTaskId = ulid();
  db.insert(tasks)
    .values({
      id: parentTaskId,
      tenantId,
      title: `Sequence: ${sequence.name}`,
      description: input,
      status: "in_progress",
      assigneeType: "agent",
      priority: "high",
      position: 0,
    })
    .run();

  // Create sequence run record
  const runId = ulid();
  db.insert(sequenceRuns)
    .values({
      id: runId,
      tenantId,
      sequenceId,
      status: "running",
      input,
      currentStep: 0,
      totalSteps: steps.length,
      taskId: parentTaskId,
      startedAt: new Date().toISOString(),
    })
    .run();

  const memory = db
    .select()
    .from(sharedMemory)
    .where(eq(sharedMemory.tenantId, tenantId))
    .all();

  // Organize steps into groups
  const groups = new Map<number, typeof steps>();
  for (const step of steps) {
    const group = groups.get(step.group) || [];
    group.push(step);
    groups.set(step.group, group);
  }

  const sortedGroupNums = Array.from(groups.keys()).sort((a, b) => a - b);

  let previousOutput = "";
  let completedStepCount = 0;

  // Execute groups sequentially; steps within a group run in parallel
  for (const groupNum of sortedGroupNums) {
    const groupSteps = groups.get(groupNum)!;
    const isParallel = groupSteps.length > 1;

    // Update progress
    db.update(sequenceRuns)
      .set({ currentStep: completedStepCount + 1 })
      .where(eq(sequenceRuns.id, runId))
      .run();

    // Build and execute all steps in this group
    const stepPromises = groupSteps.map(async (step) => {
      const agent = db
        .select()
        .from(agents)
        .where(eq(agents.id, step.agentId))
        .get();

      if (!agent) {
        throw new Error(`Agent not found for step: ${step.name}`);
      }

      const prompt = step.promptTemplate
        .replace(/\{\{sequence_input\}\}/g, input)
        .replace(/\{\{previous_output\}\}/g, previousOutput);

      const agentRunId = ulid();
      db.insert(agentRuns)
        .values({
          id: agentRunId,
          tenantId,
          agentId: agent.id,
          taskId: parentTaskId,
          status: "queued",
          trigger: "goal-decomposition",
          input: JSON.stringify({
            input: prompt,
            sequenceRunId: runId,
            stepName: step.name,
            group: step.group,
            parallel: isParallel,
          }),
        })
        .run();

      await executeAgent({
        runId: agentRunId,
        tenantId,
        agent: {
          id: agent.id,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          tools: agent.tools,
        },
        task: {
          title: `${sequence.name} — ${isParallel ? `Group ${groupNum}, ` : ""}${step.name}`,
          description: prompt,
        },
        taskId: parentTaskId,
        input: prompt,
        memory,
      });

      // Check result
      const completedRun = db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.id, agentRunId))
        .get();

      if (!completedRun || completedRun.status !== "success") {
        throw new Error(
          `Step "${step.name}" failed: ${completedRun?.error || "Unknown error"}`
        );
      }

      // Get the document
      const stepDoc = db
        .select()
        .from(documents)
        .where(eq(documents.agentRunId, agentRunId))
        .get();

      if (stepDoc) {
        db.update(documents)
          .set({ sequenceRunId: runId })
          .where(eq(documents.id, stepDoc.id))
          .run();
        return { stepName: step.name, output: stepDoc.content };
      }

      // Fallback
      let output = completedRun.output || "";
      try {
        const parsed = JSON.parse(output);
        output = parsed.result || parsed.content || output;
      } catch {
        // Use as-is
      }
      return { stepName: step.name, output };
    });

    // Wait for all steps in this group
    try {
      const results = await Promise.all(stepPromises);
      completedStepCount += groupSteps.length;

      // Merge outputs for the next group
      if (results.length === 1) {
        previousOutput = results[0].output;
      } else {
        // Multiple parallel steps — combine outputs with headers
        previousOutput = results
          .map((r) => `## Output: ${r.stepName}\n\n${r.output}`)
          .join("\n\n---\n\n");
      }
    } catch (err) {
      db.update(sequenceRuns)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date().toISOString(),
        })
        .where(eq(sequenceRuns.id, runId))
        .run();

      db.update(tasks)
        .set({ status: "blocked", updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, parentTaskId))
        .run();

      return runId;
    }

    // Update progress
    db.update(sequenceRuns)
      .set({ currentStep: completedStepCount })
      .where(eq(sequenceRuns.id, runId))
      .run();
  }

  // All groups completed
  db.update(sequenceRuns)
    .set({ status: "success", completedAt: new Date().toISOString() })
    .where(eq(sequenceRuns.id, runId))
    .run();

  db.update(tasks)
    .set({ status: "done", updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, parentTaskId))
    .run();

  return runId;
}
