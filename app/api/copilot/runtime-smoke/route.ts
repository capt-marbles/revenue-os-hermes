import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRuntime, getRuntimeById } from "@/lib/runtime";
import {
  getChiefOfStaffCodexSandboxMode,
  resolveChiefOfStaffRuntime,
} from "@/lib/copilot/runtime-selection";

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  let body: { prompt?: string; model?: string; runtimeId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const resolved = body.runtimeId
    ? {
        runtimeId: body.runtimeId,
        model: body.model,
      }
    : resolveChiefOfStaffRuntime(body.model);

  const runtime = getRuntimeById(resolved.runtimeId) || getRuntime();
  const model = resolved.model || "gpt-5.4";
  const prompt = body.prompt?.trim() || "Reply with exactly OK.";
  const sandboxMode =
    runtime.id === "codex" ? getChiefOfStaffCodexSandboxMode() : undefined;

  const result = await runtime.execute(prompt, {
    model,
    timeout: 120000,
    sandboxMode,
  });

  const status = result.exitCode === 0 ? 200 : 502;
  return Response.json(
    {
      runtimeId: runtime.id,
      model,
      sandboxMode: sandboxMode ?? null,
      result,
      ok: result.exitCode === 0,
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
