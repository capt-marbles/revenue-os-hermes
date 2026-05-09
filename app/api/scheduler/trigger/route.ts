import { db } from "@/db";
import { schedules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "@/lib/tenant";
import { shouldRunNow } from "@/lib/scheduler/cron-utils";
import { executeSequence } from "@/lib/agents/sequence-executor";
import { queueAgentRun } from "@/lib/orchestration/run-agent";
import { runCronTriggers } from "@/lib/orchestration/trigger-router";
import { ensureDailyBriefingSnapshot } from "@/lib/command-center/briefing";


/**
 * Cron trigger endpoint — called every minute by system cron.
 * Checks all enabled schedules, runs any that are due.
 *
 * System cron entry:
 *   * * * * * curl -s -X POST http://localhost:3000/api/scheduler/trigger?token=dev-token-change-me
 */
export async function POST() {
  const tenantId = getTenantId();
  ensureDailyBriefingSnapshot(tenantId);

  // Get all enabled schedules
  const activeSchedules = db
    .select()
    .from(schedules)
    .where(and(eq(schedules.tenantId, tenantId), eq(schedules.enabled, 1)))
    .all();

  const triggered: string[] = [];
  const skipped: string[] = [];

  const triggerResults = runCronTriggers(tenantId);
  triggered.push(...triggerResults.triggered);
  skipped.push(...triggerResults.skipped);

  for (const schedule of activeSchedules) {
    if (!shouldRunNow(schedule.cron, schedule.lastRunAt)) {
      skipped.push(schedule.name);
      continue;
    }

    // Mark as running
    db.update(schedules)
      .set({
        lastRunAt: new Date().toISOString(),
        runCount: (schedule.runCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schedules.id, schedule.id))
      .run();

    if (schedule.type === "agent") {
      const result = queueAgentRun({
        tenantId,
        agentId: schedule.targetId,
        input: schedule.input,
        trigger: "scheduled",
        metadata: {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
        },
      });

      if (result.accepted) {
        triggered.push(schedule.name);
      } else {
        skipped.push(`${schedule.name} (${result.reason})`);
      }
    } else if (schedule.type === "sequence") {
      executeSequence({
        sequenceId: schedule.targetId,
        input: schedule.input,
      }).catch((err) => {
        console.error(`Scheduled sequence run failed (${schedule.name}):`, err);
      });

      triggered.push(schedule.name);
    }
  }

  return Response.json({
    checked: activeSchedules.length,
    triggered: triggered.length,
    skipped: skipped.length,
    details: { triggered, skipped },
  });
}
