/**
 * hermes-notifier.ts
 *
 * Polls for completed/blocked/failed Hermes kanban tasks and fires
 * notification callbacks (Telegram / Discord webhooks) to subscribed URLs.
 *
 * Architecture:
 * - Polling loop every 60s (matches Hermes cron interval)
 * - Tracks the last-seen "done" task timestamp to avoid duplicate fires
 * - Reads subscriptions from the kanban_notify_subs table (kanbanNotify)
 * - Fires Telegram bot API calls or Discord webhook POSTs based on the sub type
 *
 * Started by the scheduler when HERMES_KANBAN_ENABLED=true.
 */

import { db } from "@/db";
import { kanbanList, kanbanShow, type HermesTask, type KanbanStatus } from "./hermes-kanban-service";
import { getTenantId } from "@/lib/tenant";

// ─── DB Schema types (inline to avoid circular imports) ────────────────────────

interface KanbanNotifySub {
  id: string;
  tenantId: string;
  taskId: string | null;
  webhookUrl: string;
  notifyOn: string; // "done" | "blocked" | "failed" | "*"
  transport: string; // "telegram" | "discord" | "webhook"
  profile: string | null;
  active: boolean;
  createdAt: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotifyTrigger = "done" | "blocked" | "failed" | "*";

interface NotificationPayload {
  trigger: NotifyTrigger;
  task: HermesTask;
  runUrl?: string;
}

// ─── Telegram helper ───────────────────────────────────────────────────────────

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
}

function formatTelegramNotification(payload: NotificationPayload): string {
  const { task, runUrl } = payload;
  const status = task.status.toUpperCase();
  const emoji = task.status === "done" ? "✅" : task.status === "blocked" ? "🚫" : "❌";

  let text = `${emoji} <b>Hermes Task ${status}</b>\n`;
  text += `<b>Task:</b> ${task.title}\n`;
  text += `<b>ID:</b> <code>${task.id}</code>\n`;
  if (task.assignee) text += `<b>Assignee:</b> ${task.assignee}\n`;
  if (task.completed_at) {
    const dt = new Date(task.completed_at).toLocaleString();
    text += `<b>Completed:</b> ${dt}\n`;
  }
  if (runUrl) text += `<b>Run:</b> <a href="${runUrl}">View</a>\n`;
  return text;
}

// ─── Discord helper ────────────────────────────────────────────────────────────

async function sendDiscordWebhook(webhookUrl: string, payload: NotificationPayload): Promise<void> {
  const { task, runUrl } = payload;
  const status = task.status.toUpperCase();
  const color = task.status === "done" ? 0x22c55e : task.status === "blocked" ? 0xf59e0b : 0xef4444;

  const body: Record<string, unknown> = {
    embeds: [
      {
        title: `Hermes Task ${status}`,
        description: task.title,
        color,
        fields: [
          { name: "Task ID", value: task.id, inline: true },
          ...(task.assignee ? [{ name: "Assignee", value: task.assignee, inline: true }] : []),
          ...(task.completed_at ? [{ name: "Completed", value: new Date(task.completed_at).toLocaleString(), inline: true }] : []),
        ],
        footer: { text: "Hermes Kanban" },
        timestamp: task.completed_at ? new Date(task.completed_at).toISOString() : new Date().toISOString(),
      },
    ],
  };

  if (runUrl) {
    body.content = `<${runUrl}|View task run>`;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook error ${res.status}: ${text}`);
  }
}

// ─── Generic webhook helper ───────────────────────────────────────────────────

async function sendGenericWebhook(webhookUrl: string, payload: NotificationPayload): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: `hermes.task.${payload.trigger}`,
      timestamp: new Date().toISOString(),
      task: {
        id: payload.task.id,
        title: payload.task.title,
        status: payload.task.status,
        assignee: payload.task.assignee,
        completed_at: payload.task.completed_at,
        created_at: payload.task.created_at,
      },
      run_url: payload.runUrl,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook error ${res.status}: ${text}`);
  }
}

// ─── HermesNotifier ───────────────────────────────────────────────────────────

export class HermesNotifier {
  private running = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastSeenDoneAt = 0; // epoch ms

  // Templates for run URL (can be overridden via env)
  private runUrlTemplate: string;

  constructor() {
    this.runUrlTemplate = process.env["HERMES_NOTIFY_RUN_URL_TEMPLATE"] ?? "https://app.revenueos.com/runs/{runId}";
  }

  /**
   * Start the polling loop. Call once at startup when HERMES_KANBAN_ENABLED=true.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervalHandle = setInterval(() => {
      void this.poll();
    }, 60_000);
    console.log("[HermesNotifier] started — polling every 60s");
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log("[HermesNotifier] stopped");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      // Fetch subscriptions for this tenant
      const subs = this.getSubscriptions();
      if (subs.length === 0) return;

      // Poll done tasks since last check
      const doneTasks = await kanbanList({ status: "done", limit: 50 });
      const recentDone = doneTasks.filter((t) => {
        return t.completed_at !== null && t.completed_at > this.lastSeenDoneAt;
      });

      // Also check blocked/failed that might have been missed
      const blockedTasks = await kanbanList({ status: "blocked", limit: 50 });
      const failedTasks = await kanbanList({ status: "blocked", limit: 50 }); // Hermes uses blocked for failures

      // Update last-seen marker
      for (const t of doneTasks) {
        if (t.completed_at && t.completed_at > this.lastSeenDoneAt) {
          this.lastSeenDoneAt = t.completed_at;
        }
      }

      // Fire notifications
      for (const sub of subs) {
        // Determine which tasks this sub cares about
        const wantsDone = sub.notifyOn === "done" || sub.notifyOn === "*";
        const wantsBlocked = sub.notifyOn === "blocked" || sub.notifyOn === "*";
        const wantsFailed = sub.notifyOn === "failed" || sub.notifyOn === "*";

        if (wantsDone && recentDone.length > 0) {
          for (const task of recentDone) {
            if (sub.taskId && sub.taskId !== task.id) continue;
            await this.fireNotification(sub, { trigger: "done", task });
          }
        }

        if (wantsBlocked && blockedTasks.length > 0) {
          for (const task of blockedTasks) {
            if (sub.taskId && sub.taskId !== task.id) continue;
            await this.fireNotification(sub, { trigger: "blocked", task });
          }
        }

        if (wantsFailed && failedTasks.length > 0) {
          for (const task of failedTasks) {
            if (sub.taskId && sub.taskId !== task.id) continue;
            await this.fireNotification(sub, { trigger: "failed", task });
          }
        }
      }
    } catch (err) {
      console.error("[HermesNotifier] poll error:", err);
    }
  }

  private async fireNotification(
    sub: KanbanNotifySub,
    payload: NotificationPayload
  ): Promise<void> {
    const runUrl = this.buildRunUrl(sub);

    try {
      if (sub.transport === "telegram") {
        const parsed = this.parseTelegramUrl(sub.webhookUrl);
        if (!parsed) {
          console.warn(`[HermesNotifier] invalid Telegram URL: ${sub.webhookUrl}`);
          return;
        }
        await sendTelegramMessage(parsed.botToken, parsed.chatId, formatTelegramNotification(payload));
      } else if (sub.transport === "discord") {
        await sendDiscordWebhook(sub.webhookUrl, { ...payload, runUrl });
      } else {
        await sendGenericWebhook(sub.webhookUrl, { ...payload, runUrl });
      }

      console.log(
        JSON.stringify({
          event: "hermes_notification_sent",
          subId: sub.id,
          transport: sub.transport,
          trigger: payload.trigger,
          taskId: payload.task.id,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.error(`[HermesNotifier] failed to notify ${sub.id}:`, err);
    }
  }

  private parseTelegramUrl(url: string): { botToken: string; chatId: string } | null {
    // Format: https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>
    // Or: telegram:<botToken>:<chatId>
    if (url.startsWith("telegram:")) {
      const parts = url.slice(10).split(":");
      if (parts.length >= 2) return { botToken: parts[0], chatId: parts[1] };
    }
    // Try parsing as full URL
    try {
      const u = new URL(url);
      if (u.hostname === "api.telegram.org") {
        const pathMatch = u.pathname.match(/^\/bot(.+?)\/sendMessage$/);
        const chatId = u.searchParams.get("chat_id");
        if (pathMatch && chatId) return { botToken: pathMatch[1], chatId };
      }
    } catch {
      // fall through
    }
    return null;
  }

  private buildRunUrl(sub: KanbanNotifySub): string | undefined {
    // If there's a run record for this task, build the URL
    // The runId is stored in the task body or we can look it up
    return this.runUrlTemplate.replace("{taskId}", sub.taskId ?? "");
  }

  private getSubscriptions(): KanbanNotifySub[] {
    // Look for a kanban_notify_subs or kanbanNotify table
    // In practice this reads from the Hermes or Revenue OS DB
    const tenantId = getTenantId();

    try {
      // Try the kanbanNotify table (defined in Hermes kanban.db)
      // We use a raw SQL approach to avoid tight schema coupling
      const result = db
        .select()
        .from("kanban_notify_subs" as any)
        .all() as KanbanNotifySub[];

      return result.filter((r) => r.tenantId === tenantId && r.active);
    } catch {
      // Table may not exist or may be in Hermes DB — return empty
      return [];
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _notifier: HermesNotifier | null = null;

export function getHermesNotifier(): HermesNotifier {
  if (!_notifier) {
    _notifier = new HermesNotifier();
  }
  return _notifier;
}
