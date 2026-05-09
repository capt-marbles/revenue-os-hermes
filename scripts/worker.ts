#!/usr/bin/env tsx
/**
 * Revenue OS background worker.
 * Polls autopilots every 60s and fires any that are due.
 *
 * Run: npx tsx scripts/worker.ts
 */

import { runDueAutopilots } from "../lib/autopilots/runner";
import { getTenantId } from "../lib/tenant";

const POLL_INTERVAL_MS = 60_000;

async function tick() {
  try {
    const tenantId = getTenantId();
    await runDueAutopilots(tenantId);
  } catch (err) {
    console.error("[worker] tick error:", err);
  }
}

console.log("[worker] Revenue OS background worker started");
console.log(`[worker] Polling every ${POLL_INTERVAL_MS / 1000}s for due autopilots`);

// Run immediately on start, then on interval
tick();
setInterval(tick, POLL_INTERVAL_MS);

// Keep alive
process.on("SIGINT", () => {
  console.log("[worker] Shutting down");
  process.exit(0);
});
