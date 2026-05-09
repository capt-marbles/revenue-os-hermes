/**
 * Pipeline cron — checks for opportunities needing agent attention
 * and triggers scheduled specialist runs.
 *
 * Used by: GET /api/scheduler/pipeline-pulse
 */

import { db } from "@/db";
import { triggers, agents, opportunities, agentRuns } from "@/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { shouldRunNow } from "./cron-utils";
import { getTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

interface PulseResult {
  triggered: number;
  details: Array<{ triggerName: string; agentId: string; runsQueued: number }>;
  errors: string[];
}

/**
 * Run the pipeline cron pulse — find active cron triggers for specialist agents
 * and queue agent runs for matching opportunities.
 */
export function runPipelineCron(): PulseResult {
  const tenantId = getTenantId();
  const result: PulseResult = { triggered: 0, details: [], errors: [] };

  // Find all active cron triggers targeting specialists
  const activeTriggers = db
    .select()
    .from(triggers)
    .where(
      and(
        eq(triggers.tenantId, tenantId),
        eq(triggers.type, "cron"),
        eq(triggers.status, "active"),
        eq(triggers.targetType, "specialist"),
      ),
    )
    .all();

  for (const trigger of activeTriggers) {
    try {
      const config = JSON.parse(trigger.scheduleConfig || "{}");
      const cron = config.cron;
      if (!cron) {
        result.errors.push(`Trigger ${trigger.name} has no cron expression`);
        continue;
      }

      // Check if this trigger should fire now
      if (!shouldRunNow(cron, trigger.lastFiredAt)) {
        continue;
      }

      // Verify agent exists
      const agent = db
        .select()
        .from(agents)
        .where(and(eq(agents.id, trigger.targetId), eq(agents.tenantId, tenantId)))
        .get();

      if (!agent) {
        result.errors.push(`Trigger ${trigger.name}: agent ${trigger.targetId} not found`);
        continue;
      }

      // Determine what opportunities need attention based on agent slug
      const runsQueued = queueRunsForAgent(
        tenantId,
        agent.id,
        agent.slug,
        config.input || "",
        trigger.id,
        trigger.name,
      );

      if (runsQueued > 0) {
        result.triggered += runsQueued;
        result.details.push({
          triggerName: trigger.name,
          agentId: agent.id,
          runsQueued,
        });

        // Update lastFiredAt
        const now = new Date().toISOString();
        db.update(triggers)
          .set({ lastFiredAt: now, updatedAt: now })
          .where(eq(triggers.id, trigger.id))
          .run();

        logAudit({
          action: "scheduler.pipeline_cron",
          entity: "trigger",
          entityId: trigger.id,
          summary: `Pipeline cron fired "${trigger.name}" → ${agent.name}: ${runsQueued} runs queued`,
          source: "scheduler",
          metadata: { triggerName: trigger.name, agentSlug: agent.slug, runsQueued },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Trigger ${trigger.name}: ${msg}`);
    }
  }

  return result;
}

/**
 * Queue agent runs for opportunities matching the agent's focus.
 */
function queueRunsForAgent(
  tenantId: string,
  agentId: string,
  agentSlug: string,
  input: string,
  triggerId: string,
  triggerName: string,
): number {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  switch (agentSlug) {
    case "scout": {
      // Find enriched opportunities with no agent run in last 24h
      const opps = db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.tenantId, tenantId),
            eq(opportunities.status, "enriched"),
          ),
        )
        .all()
        .filter((opp) => {
          // Check if this agent ran on this opportunity recently
          const recentRun = db
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.agentId, agentId),
                eq(agentRuns.tenantId, tenantId),
                gt(agentRuns.createdAt, twentyFourHoursAgo),
                sql`json_extract(${agentRuns.input}, '$.opportunityId') = ${opp.id}`,
              ),
            )
            .get();
          return !recentRun;
        });

      const now = new Date().toISOString();
      for (const opp of opps) {
        const runId = ulid();
        db.insert(agentRuns)
          .values({
            id: runId,
            tenantId,
            agentId,
            status: "queued",
            trigger: `cron:${triggerId}`,
            input: JSON.stringify({
              input,
              opportunityId: opp.id,
              opportunityTitle: opp.title,
              accountName: opp.accountName,
              source: "pipeline_cron",
            }),
            createdAt: now,
          })
          .run();
      }

      return opps.length;
    }

    case "outreach": {
      // Find scored/queued opportunities needing outreach drafts
      const opps = db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.tenantId, tenantId),
            sql`${opportunities.status} IN ('scored', 'queued')`,
          ),
        )
        .all()
        .filter((opp) => {
          const recentRun = db
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.agentId, agentId),
                eq(agentRuns.tenantId, tenantId),
                gt(agentRuns.createdAt, twentyFourHoursAgo),
                sql`json_extract(${agentRuns.input}, '$.opportunityId') = ${opp.id}`,
              ),
            )
            .get();
          return !recentRun;
        });

      const now = new Date().toISOString();
      for (const opp of opps) {
        const runId = ulid();
        db.insert(agentRuns)
          .values({
            id: runId,
            tenantId,
            agentId,
            status: "queued",
            trigger: `cron:${triggerId}`,
            input: JSON.stringify({
              input,
              opportunityId: opp.id,
              opportunityTitle: opp.title,
              accountName: opp.accountName,
              contactName: opp.primaryContactName,
              source: "pipeline_cron",
            }),
            createdAt: now,
          })
          .run();
      }

      return opps.length;
    }

    case "steward": {
      // Find synced opportunities without recent follow-up
      const opps = db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.tenantId, tenantId),
            eq(opportunities.status, "active_followup"),
          ),
        )
        .all()
        .filter((opp) => {
          const recentRun = db
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.agentId, agentId),
                eq(agentRuns.tenantId, tenantId),
                gt(agentRuns.createdAt, twentyFourHoursAgo),
                sql`json_extract(${agentRuns.input}, '$.opportunityId') = ${opp.id}`,
              ),
            )
            .get();
          return !recentRun;
        });

      const now = new Date().toISOString();
      for (const opp of opps) {
        const runId = ulid();
        db.insert(agentRuns)
          .values({
            id: runId,
            tenantId,
            agentId,
            status: "queued",
            trigger: `cron:${triggerId}`,
            input: JSON.stringify({
              input,
              opportunityId: opp.id,
              opportunityTitle: opp.title,
              accountName: opp.accountName,
              source: "pipeline_cron",
            }),
            createdAt: now,
          })
          .run();
      }

      return opps.length;
    }

    default:
      return 0;
  }
}
