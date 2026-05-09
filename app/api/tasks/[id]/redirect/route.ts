import { NextRequest } from "next/server";
import { redirectTask } from "@/lib/agents/task-engine";
import { z } from "zod";

const redirectSchema = z.object({
  instructions: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = redirectSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  redirectTask(id, parsed.data.instructions);

  return Response.json({ success: true });
}
