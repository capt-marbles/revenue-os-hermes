/**
 * Experiment service — A/B tests between pipeline configs.
 *
 * CoS proposes experiments, human approves. Revenue OS routes opportunities
 * between control and treatment arms. Metrics are collected automatically.
 * CoS analyzes results and generates a conclusion insight.
 */

import { db } from "@/db";
import { experiments, experimentAssignments, opportunities, outreachSends, outreachResponses } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { getTenantId } from "@/lib/tenant";
import { createInsight } from "./insights";
import { createChangeProposal } from "./change-proposals";

export interface ExperimentCreate {
  tenantId?: string;
  name: string;
  hypothesis: string;
  controlConfigId: string;
  treatmentConfigId: string;
  splitPercent?: number;
  metricName?: string;
  metricDirection?: "higher_is_better" | "lower_is_better";
  minSampleSize?: number;
}

/**
 * Create an experiment (draft state).
 */
export function createExperiment(params: ExperimentCreate): string {
  const tid = params.tenantId ?? getTenantId();
  const id = ulid();
  const now = new Date().toISOString();

  db.insert(experiments)
    .values({
      id,
      tenantId: tid,
      name: params.name,
      hypothesis: params.hypothesis,
      controlConfigId: params.controlConfigId,
      treatmentConfigId: params.treatmentConfigId,
      splitPercent: params.splitPercent ?? 50,
      metricName: params.metricName ?? "reply_rate",
      metricDirection: params.metricDirection ?? "higher_is_better",
      minSampleSize: params.minSampleSize ?? 50,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return id;
}

/**
 * Start an experiment.
 */
export function startExperiment(experimentId: string, tenantId?: string): boolean {
  const tid = tenantId ?? getTenantId();

  const experiment = db
    .select()
    .from(experiments)
    .where(and(eq(experiments.id, experimentId), eq(experiments.tenantId, tid)))
    .get();

  if (!experiment || experiment.status !== "draft") return false;

  const now = new Date().toISOString();
  db.update(experiments)
    .set({
      status: "running",
      startDate: now,
      updatedAt: now,
    })
    .where(eq(experiments.id, experimentId))
    .run();

  return true;
}

/**
 * Cancel an experiment.
 */
export function cancelExperiment(experimentId: string, tenantId?: string): boolean {
  const tid = tenantId ?? getTenantId();

  db.update(experiments)
    .set({
      status: "cancelled",
      endDate: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(experiments.id, experimentId), eq(experiments.tenantId, tid)))
    .run();

  return true;
}

/**
 * Get active running experiment for a tenant.
 */
export function getActiveExperiment(tenantId?: string) {
  const tid = tenantId ?? getTenantId();
  return db
    .select()
    .from(experiments)
    .where(and(eq(experiments.tenantId, tid), eq(experiments.status, "running")))
    .get();
}

/**
 * Route an opportunity to control or treatment arm.
 * Uses deterministic hashing so the same opportunity always gets the same arm.
 */
export function assignExperimentArm(
  experimentId: string,
  entityType: "opportunity" | "send" | "run",
  entityId: string,
  tenantId?: string,
): { arm: "control" | "treatment"; pipelineConfigId: string } | null {
  const tid = tenantId ?? getTenantId();

  const experiment = db
    .select()
    .from(experiments)
    .where(eq(experiments.id, experimentId))
    .get();

  if (!experiment || experiment.status !== "running") return null;

  // Check if already assigned
  const existing = db
    .select()
    .from(experimentAssignments)
    .where(
      and(
        eq(experimentAssignments.experimentId, experimentId),
        eq(experimentAssignments.entityType, entityType),
        eq(experimentAssignments.entityId, entityId),
      ),
    )
    .get();

  if (existing) {
    const arm = existing.arm as "control" | "treatment";
    return {
      arm,
      pipelineConfigId: arm === "control" ? experiment.controlConfigId : experiment.treatmentConfigId,
    };
  }

  // Deterministic assignment based on entity ID hash
  let hash = 0;
  for (let i = 0; i < entityId.length; i++) {
    hash = ((hash << 5) - hash + entityId.charCodeAt(i)) | 0;
  }
  const normalized = Math.abs(hash) % 100;
  const arm = normalized < experiment.splitPercent ? "treatment" : "control";

  const configId = arm === "control" ? experiment.controlConfigId : experiment.treatmentConfigId;

  // Record the assignment
  db.insert(experimentAssignments)
    .values({
      id: ulid(),
      tenantId: tid,
      experimentId,
      arm,
      pipelineConfigId: configId,
      entityType,
      entityId,
    })
    .run();

  return { arm, pipelineConfigId: configId };
}

/**
 * Collect metrics for an experiment.
 * Returns current sample size and metric values for both arms.
 */
export function collectExperimentMetrics(experimentId: string, tenantId?: string) {
  const tid = tenantId ?? getTenantId();

  const experiment = db
    .select()
    .from(experiments)
    .where(and(eq(experiments.id, experimentId), eq(experiments.tenantId, tid)))
    .get();

  if (!experiment) return null;

  // Get assignments for each arm
  const assignments = db
    .select()
    .from(experimentAssignments)
    .where(eq(experimentAssignments.experimentId, experimentId))
    .all();

  const controlIds = assignments.filter((a) => a.arm === "control").map((a) => a.entityId);
  const treatmentIds = assignments.filter((a) => a.arm === "treatment").map((a) => a.entityId);

  const metric = experiment.metricName;

  // Calculate metrics based on metric type
  let controlValue: number | null = null;
  let treatmentValue: number | null = null;

  if (metric === "reply_rate" && controlIds.length > 0 && treatmentIds.length > 0) {
    const controlReplies = db
      .select({ count: sql<number>`count(*)` })
      .from(outreachSends)
      .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
      .where(
        and(
          eq(outreachSends.tenantId, tid),
          sql`${outreachResponses.responseType} = 'reply'`,
          sql`(${outreachSends.contactRef}) in (${sql.join(controlIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      )
      .get()?.count ?? 0;

    const treatmentReplies = db
      .select({ count: sql<number>`count(*)` })
      .from(outreachSends)
      .leftJoin(outreachResponses, eq(outreachResponses.sendId, outreachSends.id))
      .where(
        and(
          eq(outreachSends.tenantId, tid),
          sql`${outreachResponses.responseType} = 'reply'`,
          sql`(${outreachSends.contactRef}) in (${sql.join(treatmentIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      )
      .get()?.count ?? 0;

    controlValue = controlIds.length > 0 ? controlReplies / controlIds.length : 0;
    treatmentValue = treatmentIds.length > 0 ? treatmentReplies / treatmentIds.length : 0;
  }

  return {
    controlSampleSize: controlIds.length,
    treatmentSampleSize: treatmentIds.length,
    controlMetricValue: controlValue,
    treatmentMetricValue: treatmentValue,
    metricName: metric,
    metricDirection: experiment.metricDirection,
  };
}

/**
 * Conclude an experiment.
 * Collects final metrics, generates a CoS insight, and optionally creates a change proposal.
 */
export function concludeExperiment(experimentId: string, tenantId?: string): string | null {
  const tid = tenantId ?? getTenantId();
  const now = new Date().toISOString();

  const experiment = db
    .select()
    .from(experiments)
    .where(and(eq(experiments.id, experimentId), eq(experiments.tenantId, tid)))
    .get();

  if (!experiment || experiment.status !== "running") return null;

  const metrics = collectExperimentMetrics(experimentId, tid);
  if (!metrics) return null;

  // Determine winner
  const controlVal = metrics.controlMetricValue ?? 0;
  const treatmentVal = metrics.treatmentMetricValue ?? 0;
  const isHigherBetter = experiment.metricDirection === "higher_is_better";
  const treatmentWins = isHigherBetter ? treatmentVal > controlVal : treatmentVal < controlVal;

  const conclusion = treatmentWins
    ? `Treatment (${Math.round(treatmentVal * 100)}%) outperformed control (${Math.round(controlVal * 100)}%) for ${metrics.metricName}. Recommend activating treatment config.`
    : `Control (${Math.round(controlVal * 100)}%) matched or outperformed treatment (${Math.round(treatmentVal * 100)}%) for ${metrics.metricName}. No config change recommended.`;

  db.update(experiments)
    .set({
      status: "completed",
      endDate: now,
      sampleSize: metrics.controlSampleSize + metrics.treatmentSampleSize,
      controlMetricValue: metrics.controlMetricValue,
      treatmentMetricValue: metrics.treatmentMetricValue,
      conclusion,
      concludedAt: now,
      updatedAt: now,
    })
    .where(eq(experiments.id, experimentId))
    .run();

  // Create CoS insight
  const insightId = createInsight({
    category: "pattern",
    severity: treatmentWins ? "medium" : "info",
    title: `Experiment "${experiment.name}" concluded`,
    detail: conclusion,
    evidence: [metrics],
    actionProposed: treatmentWins
      ? `Activate treatment config (${experiment.treatmentConfigId}) as the new pipeline default.`
      : undefined,
    experimentId,
  });

  // If treatment won, create a change proposal to activate it
  if (treatmentWins) {
    createChangeProposal({
      tenantId: tid,
      title: `Activate treatment config from experiment "${experiment.name}"`,
      description: experiment.hypothesis,
      source: "experiment",
      changeType: "threshold", // closest type — it's activating a whole config
      targetTable: "pipeline_configs",
      targetId: experiment.treatmentConfigId,
      afterState: { action: "activate" },
      experimentId,
    });
  }

  return insightId;
}

/**
 * List experiments for a tenant.
 */
export function listExperiments(tenantId?: string, limit = 20) {
  const tid = tenantId ?? getTenantId();
  return db
    .select()
    .from(experiments)
    .where(eq(experiments.tenantId, tid))
    .orderBy(desc(experiments.updatedAt))
    .limit(limit)
    .all();
}
