/**
 * Next.js instrumentation hook — runs once on server startup.
 * Used to start background workers that need to run alongside the app.
 */
export async function register() {
  // Only run on the Node.js server runtime, not during builds or edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler/scheduler-worker");
    startScheduler();
  }
}
