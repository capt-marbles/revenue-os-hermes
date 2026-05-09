import { db } from "@/db";
import { triggers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { shouldRunNow } from "@/lib/scheduler/cron-utils";
import { queueAgentRun } from "@/lib/orchestration/run-agent";
import { executePolicyTarget } from "@/lib/orchestration/policy-router";

interface TriggerPayload {
  input: string;
  source: string;
  metadata?: Record<string, unknown>;
}

interface TriggerFilterConfig {
  source?: string;
  eventTypes?: string[];
  keywords?: string[];
  chatIds?: Array<number | string>;
  commandsOnly?: boolean;
  excludeCommands?: boolean;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function dispatchTriggerById(tenantId: string, triggerId: string, payload: TriggerPayload) {
  const trigger = db
    .select()
    .from(triggers)
    .where(and(eq(triggers.id, triggerId), eq(triggers.tenantId, tenantId)))
    .get();

  if (!trigger || trigger.status !== "active") {
    return { accepted: false, reason: "trigger_not_available", runId: "" };
  }

  const result =
    trigger.targetType === "policy"
      ? executePolicyTarget(trigger.targetId, {
          tenantId,
          input: payload.input,
          triggerSource: payload.source,
          triggerId: trigger.id,
        })
      : queueAgentRun({
          tenantId,
          agentId: trigger.targetId,
          input: payload.input,
          trigger: trigger.type,
          metadata: {
            triggerId: trigger.id,
            triggerName: trigger.name,
            triggerSource: payload.source,
            ...payload.metadata,
          },
        });

  if (result.accepted) {
    db.update(triggers)
      .set({
        lastFiredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(triggers.id, trigger.id))
      .run();
  }

  return result;
}

function matchesFilter(triggerFilter: string, payload: TriggerPayload) {
  const filter = parseJson<TriggerFilterConfig>(triggerFilter, {});
  const normalizedInput = payload.input.toLowerCase();
  const metadata = payload.metadata || {};

  if (filter.source && filter.source !== payload.source) {
    return false;
  }

  if (filter.commandsOnly && !metadata.isCommand) {
    return false;
  }

  if (filter.excludeCommands && metadata.isCommand) {
    return false;
  }

  if (filter.chatIds && filter.chatIds.length > 0) {
    const chatId = metadata.chatId;
    if (!filter.chatIds.some((candidate) => String(candidate) === String(chatId))) {
      return false;
    }
  }

  if (filter.keywords && filter.keywords.length > 0) {
    const hasKeyword = filter.keywords.some((keyword) =>
      normalizedInput.includes(keyword.toLowerCase()),
    );
    if (!hasKeyword) {
      return false;
    }
  }

  if (filter.eventTypes && filter.eventTypes.length > 0) {
    const eventType = typeof metadata.eventType === "string" ? metadata.eventType : "";
    if (!filter.eventTypes.includes(eventType)) {
      return false;
    }
  }

  return true;
}

export function dispatchMatchingTriggers(tenantId: string, triggerType: string, payload: TriggerPayload) {
  const activeTriggers = db
    .select()
    .from(triggers)
    .where(and(eq(triggers.tenantId, tenantId), eq(triggers.type, triggerType), eq(triggers.status, "active")))
    .all();

  const triggered: Array<{ id: string; name: string; runId: string }> = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  for (const trigger of activeTriggers) {
    if (!matchesFilter(trigger.filterConfig, payload)) {
      skipped.push({ id: trigger.id, name: trigger.name, reason: "filter_miss" });
      continue;
    }

    const result = dispatchTriggerById(tenantId, trigger.id, payload);
    if (result.accepted) {
      triggered.push({ id: trigger.id, name: trigger.name, runId: result.runId });
    } else {
      skipped.push({ id: trigger.id, name: trigger.name, reason: result.reason || "dispatch_failed" });
    }
  }

  return { triggered, skipped };
}

export function runCronTriggers(tenantId: string) {
  const activeTriggers = db
    .select()
    .from(triggers)
    .where(and(eq(triggers.tenantId, tenantId), eq(triggers.type, "cron"), eq(triggers.status, "active")))
    .all();

  const triggered: string[] = [];
  const skipped: string[] = [];

  for (const trigger of activeTriggers) {
    const scheduleConfig = parseJson<{ cron?: string; input?: string; purpose?: string }>(
      trigger.scheduleConfig,
      {},
    );
    const cron = scheduleConfig.cron;

    if (!cron || !shouldRunNow(cron, trigger.lastFiredAt)) {
      skipped.push(trigger.name);
      continue;
    }

    const defaultInput =
      scheduleConfig.input ||
      scheduleConfig.purpose ||
      `Trigger fired: ${trigger.name}`;

    const result = dispatchTriggerById(tenantId, trigger.id, {
      input: defaultInput,
      source: "cron",
      metadata: { cron },
    });

    if (result.accepted) {
      triggered.push(trigger.name);
    } else {
      skipped.push(`${trigger.name} (${result.reason})`);
    }
  }

  return { triggered, skipped };
}
