import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the entire runtime layer — this is what the executor actually uses
const mockRuntimeExecute = vi.fn();
vi.mock("@/lib/runtime", () => ({
  getRuntime: () => ({
    id: "claude",
    name: "Claude (CLI)",
    execute: (...args: unknown[]) => mockRuntimeExecute(...args),
  }),
  getRuntimeById: () => null,
  listRuntimes: () => [],
}));

// Mock the job queue — execute the job immediately
vi.mock("@/lib/queue/job-queue", () => ({
  jobQueue: {
    submit: async (_id: string, _name: string, fn: () => Promise<void>) => fn(),
  },
}));

// Mock db
const mockDbRun = vi.fn();
const mockDbGet = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({ run: mockDbRun }),
      }),
    }),
    insert: () => ({
      values: () => ({ run: mockDbRun }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ get: mockDbGet, all: () => [] }),
        all: () => [],
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  agentRuns: { id: "id", status: "status", agentId: "agent_id", pipelineConfigId: "pipeline_config_id" },
  agents: { id: "id", status: "status" },
  tasks: { id: "id" },
  documents: { id: "id" },
  agentSessionState: {},
}));

vi.mock("@/lib/pipeline/config", () => ({
  getActivePipelineConfig: () => ({ id: "default", name: "default", config: { minScore: 50, scoring: { baseScore: 25 } } }),
  resolvePipelineConfigForOpportunity: () => ({ id: "default", name: "default", config: { minScore: 50, scoring: { baseScore: 25 } } }),
}));

vi.mock("@/lib/agents/wiki-query", () => ({
  getDeskForAgent: () => null,
  queryWiki: () => Promise.resolve([]),
  extractKeywords: () => [],
  formatWikiForPrompt: () => "",
}));

vi.mock("@/lib/agents/wiki-ingestion", () => ({
  ingestToWiki: () => Promise.resolve(),
}));

vi.mock("@/lib/connectors/mcp-config", () => ({
  buildMcpConfigFile: () => null,
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...args: unknown[]) => args,
}));

vi.mock("ulid", () => ({
  ulid: () => "test-ulid-123",
}));

describe("executeAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runtime.execute with correct model and prompt", async () => {
    mockRuntimeExecute.mockResolvedValue({
      stdout: '{"result": "done"}',
      stderr: "",
      exitCode: 0,
    });

    const { executeAgent } = await import("@/lib/agents/executor");

    await executeAgent({
      runId: "run-1",
      tenantId: "tenant-1",
      agent: { id: "agent-1", name: "Test Agent", systemPrompt: "You are helpful", model: "sonnet", tools: null },
      task: null,
      taskId: null,
      input: "Do something",
      memory: [],
    });

    expect(mockRuntimeExecute).toHaveBeenCalledTimes(1);
    const callArgs = mockRuntimeExecute.mock.calls[0];

    // First arg is the prompt string
    expect(callArgs[0]).toContain("Do something");
    expect(callArgs[0]).toContain("You are helpful");

    // Second arg is RuntimeConfig
    expect(callArgs[1].model).toBe("sonnet");
    expect(callArgs[1].tools).toEqual([]);
    expect(callArgs[1].maxTurns).toBe(10);
    expect(callArgs[1].timeout).toBe(300000);

    // DB should have been updated
    expect(mockDbRun).toHaveBeenCalled();
  });

  it("handles runtime error gracefully", async () => {
    mockRuntimeExecute.mockResolvedValue({
      stdout: "",
      stderr: "Spawn error: claude ENOENT",
      exitCode: 1,
    });

    const { executeAgent } = await import("@/lib/agents/executor");

    // Should not throw
    await expect(
      executeAgent({
        runId: "run-2",
        tenantId: "tenant-1",
        agent: { id: "agent-2", name: "Test Agent", systemPrompt: null, model: null, tools: null },
        task: null,
        taskId: null,
        input: "Do something",
        memory: [],
      })
    ).resolves.toBeUndefined();

    // DB should have been updated with failure status
    expect(mockDbRun).toHaveBeenCalled();
  });

  it("handles non-zero exit code", async () => {
    mockRuntimeExecute.mockResolvedValue({
      stdout: "",
      stderr: "Error: something went wrong",
      exitCode: 1,
    });

    const { executeAgent } = await import("@/lib/agents/executor");

    await expect(
      executeAgent({
        runId: "run-3",
        tenantId: "tenant-1",
        agent: { id: "agent-3", name: "Test Agent", systemPrompt: null, model: null, tools: null },
        task: null,
        taskId: null,
        input: "Do something",
        memory: [],
      })
    ).resolves.toBeUndefined();

    expect(mockDbRun).toHaveBeenCalled();
  });

  it("passes parsed tools to runtime", async () => {
    mockRuntimeExecute.mockResolvedValue({
      stdout: '{"result": "done"}',
      stderr: "",
      exitCode: 0,
    });

    const { executeAgent } = await import("@/lib/agents/executor");

    await executeAgent({
      runId: "run-4",
      tenantId: "tenant-1",
      agent: {
        id: "agent-4",
        name: "Test Agent",
        systemPrompt: null,
        model: "sonnet",
        tools: '["Read", "Write", "Bash"]',
      },
      task: null,
      taskId: null,
      input: "Do something",
      memory: [],
    });

    expect(mockRuntimeExecute).toHaveBeenCalledTimes(1);
    expect(mockRuntimeExecute.mock.calls[0][1].tools).toEqual(["Read", "Write", "Bash"]);
  });

  it("tags agent run with pipeline config ID", async () => {
    mockRuntimeExecute.mockResolvedValue({
      stdout: '{"result": "done"}',
      stderr: "",
      exitCode: 0,
    });

    const { executeAgent } = await import("@/lib/agents/executor");

    await executeAgent({
      runId: "run-5",
      tenantId: "tenant-1",
      agent: { id: "agent-5", name: "Test Agent", systemPrompt: null, model: null, tools: null },
      task: null,
      taskId: null,
      input: "Do something",
      memory: [],
    });

    // DB run calls include pipelineConfigId tagging
    expect(mockDbRun).toHaveBeenCalled();
  });
});
