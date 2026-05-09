import { NextRequest } from "next/server";
import { jobQueue } from "@/lib/queue/job-queue";
import { z } from "zod";

export async function GET() {
  return Response.json(jobQueue.stats);
}

const updateSchema = z.object({
  maxConcurrent: z.number().min(1).max(20).optional(),
  maxBatchSize: z.number().min(0).max(100).optional(),
});

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.maxConcurrent !== undefined) {
    jobQueue.maxConcurrent = parsed.data.maxConcurrent;
  }
  if (parsed.data.maxBatchSize !== undefined) {
    jobQueue.maxBatchSize = parsed.data.maxBatchSize;
  }

  return Response.json(jobQueue.stats);
}
