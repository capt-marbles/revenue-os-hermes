// Cron expression utilities
// Supports standard 5-field cron: minute hour day-of-month month day-of-week

const CRON_PRESETS: Record<string, { label: string; cron: string; description: string }> = {
  "daily-9am": { label: "Daily at 9am", cron: "0 9 * * *", description: "Every day at 9:00 AM" },
  "weekdays-9am": { label: "Weekdays at 9am", cron: "0 9 * * 1-5", description: "Monday-Friday at 9:00 AM" },
  "weekly-monday": { label: "Weekly (Monday 9am)", cron: "0 9 * * 1", description: "Every Monday at 9:00 AM" },
  "weekly-friday": { label: "Weekly (Friday 9am)", cron: "0 9 * * 5", description: "Every Friday at 9:00 AM" },
  "biweekly": { label: "Every 2 weeks (Monday)", cron: "0 9 1,15 * *", description: "1st and 15th of each month at 9:00 AM" },
  "monthly": { label: "Monthly (1st at 9am)", cron: "0 9 1 * *", description: "1st of every month at 9:00 AM" },
  "every-6h": { label: "Every 6 hours", cron: "0 */6 * * *", description: "At minute 0 every 6 hours" },
  "every-12h": { label: "Every 12 hours", cron: "0 */12 * * *", description: "At minute 0 every 12 hours" },
};

export { CRON_PRESETS };

/**
 * Describe a cron expression in human-readable form.
 */
export function describeCron(cron: string): string {
  const preset = Object.values(CRON_PRESETS).find((p) => p.cron === cron);
  if (preset) return preset.description;

  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;

  const [minute, hour, dom, month, dow] = parts;

  if (dow !== "*" && dom === "*" && month === "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayStr = dow.split(",").map((d) => {
      if (d.includes("-")) {
        const [start, end] = d.split("-").map(Number);
        return `${days[start]}-${days[end]}`;
      }
      return days[parseInt(d)] || d;
    }).join(", ");
    return `${dayStr} at ${hour}:${minute.padStart(2, "0")}`;
  }

  if (hour.startsWith("*/")) {
    return `Every ${hour.slice(2)} hours`;
  }

  return `${hour}:${minute.padStart(2, "0")} ${dom !== "*" ? `day ${dom}` : "daily"}`;
}

/**
 * Check if a schedule should run now, given its cron expression and last run time.
 * Uses a 2-minute window to account for cron job timing variance.
 */
export function shouldRunNow(cron: string, lastRunAt: string | null): boolean {
  const now = new Date();
  const parts = cron.split(" ");
  if (parts.length !== 5) return false;

  const [cronMin, cronHour, cronDom, cronMonth, cronDow] = parts;

  // Check minute
  if (cronMin !== "*" && !matchesCronField(cronMin, now.getMinutes())) return false;
  // Check hour
  if (cronHour !== "*" && !matchesCronField(cronHour, now.getHours())) return false;
  // Check day of month
  if (cronDom !== "*" && !matchesCronField(cronDom, now.getDate())) return false;
  // Check month (cron months are 1-12)
  if (cronMonth !== "*" && !matchesCronField(cronMonth, now.getMonth() + 1)) return false;
  // Check day of week (0=Sun, 6=Sat)
  if (cronDow !== "*" && !matchesCronField(cronDow, now.getDay())) return false;

  // Prevent double-runs: check if last run was within the last 5 minutes
  if (lastRunAt) {
    const lastRun = new Date(lastRunAt);
    const diffMs = now.getTime() - lastRun.getTime();
    if (diffMs < 5 * 60 * 1000) return false; // Already ran recently
  }

  return true;
}

function matchesCronField(field: string, value: number): boolean {
  // Handle */N (every N)
  if (field.startsWith("*/")) {
    const interval = parseInt(field.slice(2));
    return value % interval === 0;
  }

  // Handle comma-separated values
  const parts = field.split(",");
  for (const part of parts) {
    // Handle ranges (e.g., 1-5)
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (value >= start && value <= end) return true;
    } else {
      if (parseInt(part) === value) return true;
    }
  }

  return false;
}
