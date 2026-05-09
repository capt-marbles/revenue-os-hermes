import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime", () => ({
  getRuntime: () => ({ id: "claude" }),
}));

const originalEnv = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CHIEF_OF_STAFF_RUNTIME: process.env.CHIEF_OF_STAFF_RUNTIME,
  COPILOT_COS_RUNTIME: process.env.COPILOT_COS_RUNTIME,
  CHIEF_OF_STAFF_CODEX_MODEL: process.env.CHIEF_OF_STAFF_CODEX_MODEL,
  CHIEF_OF_STAFF_CODEX_SANDBOX: process.env.CHIEF_OF_STAFF_CODEX_SANDBOX,
};

describe("resolveChiefOfStaffRuntime", () => {
  afterEach(() => {
    vi.resetModules();

    if (originalEnv.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;

    if (originalEnv.CHIEF_OF_STAFF_RUNTIME === undefined) delete process.env.CHIEF_OF_STAFF_RUNTIME;
    else process.env.CHIEF_OF_STAFF_RUNTIME = originalEnv.CHIEF_OF_STAFF_RUNTIME;

    if (originalEnv.COPILOT_COS_RUNTIME === undefined) delete process.env.COPILOT_COS_RUNTIME;
    else process.env.COPILOT_COS_RUNTIME = originalEnv.COPILOT_COS_RUNTIME;

    if (originalEnv.CHIEF_OF_STAFF_CODEX_MODEL === undefined) delete process.env.CHIEF_OF_STAFF_CODEX_MODEL;
    else process.env.CHIEF_OF_STAFF_CODEX_MODEL = originalEnv.CHIEF_OF_STAFF_CODEX_MODEL;

    if (originalEnv.CHIEF_OF_STAFF_CODEX_SANDBOX === undefined) delete process.env.CHIEF_OF_STAFF_CODEX_SANDBOX;
    else process.env.CHIEF_OF_STAFF_CODEX_SANDBOX = originalEnv.CHIEF_OF_STAFF_CODEX_SANDBOX;
  });

  it("prefers a model runtime override", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    const { resolveChiefOfStaffRuntime } = await import("@/lib/copilot/runtime-selection");

    expect(resolveChiefOfStaffRuntime("codex:gpt-5.4-mini")).toEqual({
      runtimeId: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("uses the configured codex runtime when set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CHIEF_OF_STAFF_RUNTIME = "codex";
    process.env.CHIEF_OF_STAFF_CODEX_MODEL = "gpt-5.5";

    const { resolveChiefOfStaffRuntime } = await import("@/lib/copilot/runtime-selection");

    expect(resolveChiefOfStaffRuntime()).toEqual({
      runtimeId: "codex",
      model: "gpt-5.5",
    });
  });

  it("coerces a plain anthropic model id to the codex default when codex is selected", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CHIEF_OF_STAFF_RUNTIME = "codex";
    process.env.CHIEF_OF_STAFF_CODEX_MODEL = "gpt-5.4";

    const { resolveChiefOfStaffRuntime } = await import("@/lib/copilot/runtime-selection");

    expect(resolveChiefOfStaffRuntime("claude-sonnet-4-20250514")).toEqual({
      runtimeId: "codex",
      model: "gpt-5.4",
    });
  });

  it("keeps an explicit codex-prefixed model override", async () => {
    process.env.CHIEF_OF_STAFF_RUNTIME = "codex";

    const { resolveChiefOfStaffRuntime } = await import("@/lib/copilot/runtime-selection");

    expect(resolveChiefOfStaffRuntime("codex:gpt-5.4-mini")).toEqual({
      runtimeId: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("falls back to anthropic when available and no override is set", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    delete process.env.CHIEF_OF_STAFF_RUNTIME;
    delete process.env.COPILOT_COS_RUNTIME;

    const { resolveChiefOfStaffRuntime } = await import("@/lib/copilot/runtime-selection");

    expect(resolveChiefOfStaffRuntime()).toEqual({
      runtimeId: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("parses the codex sandbox mode from env", async () => {
    process.env.CHIEF_OF_STAFF_CODEX_SANDBOX = "danger-full-access";
    const { getChiefOfStaffCodexSandboxMode } = await import("@/lib/copilot/runtime-selection");

    expect(getChiefOfStaffCodexSandboxMode()).toBe("danger-full-access");
  });
});
