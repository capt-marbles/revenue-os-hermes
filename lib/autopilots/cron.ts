/**
 * Minimal cron parser for daily/hourly schedules.
 * Supports: "0 H * * *" (daily at hour H), "0 *\/N * * *" (every N hours),
 * "M H * * *" (daily at H:M).
 */
export function computeNextRun(cronExpr: string, from: Date = new Date()): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${cronExpr}`);

  const [minPart, hourPart] = parts;

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1); // advance at least 1 minute

  // "0 H * * *" — daily at specific hour
  if (/^\d+$/.test(hourPart) && /^\d+$/.test(minPart)) {
    const targetHour = parseInt(hourPart, 10);
    const targetMin = parseInt(minPart, 10);
    next.setHours(targetHour, targetMin, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // "0 */N * * *" — every N hours
  const everyHourMatch = hourPart.match(/^\*\/(\d+)$/);
  if (everyHourMatch) {
    const interval = parseInt(everyHourMatch[1], 10);
    next.setMinutes(parseInt(minPart, 10) || 0, 0, 0);
    while (next <= from) next.setHours(next.getHours() + interval);
    return next;
  }

  // Fallback: 24 hours from now
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

export function isDue(nextRunAt: string | null): boolean {
  if (!nextRunAt) return true;
  return new Date(nextRunAt) <= new Date();
}

export function formatCron(cronExpr: string): string {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpr;
  const [min, hour] = parts;

  if (/^\d+$/.test(hour) && /^\d+$/.test(min)) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const displayHour = h % 12 || 12;
    const displayMin = m.toString().padStart(2, "0");
    return `Daily at ${displayHour}:${displayMin} ${ampm}`;
  }

  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (everyHourMatch) return `Every ${everyHourMatch[1]}h`;

  return cronExpr;
}
