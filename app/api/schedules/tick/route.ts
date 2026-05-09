import { tickScheduler } from "@/lib/scheduler/scheduler-worker";

export async function POST() {
  const fired = await tickScheduler();
  return Response.json({ fired });
}
