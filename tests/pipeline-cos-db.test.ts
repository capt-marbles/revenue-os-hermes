import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

// ─── Create a test in-memory DB ─────────────────────────────────────────────

let testDb: ReturnType<typeof drizzle>;
const TEST_TENANT = "TEST_TENANT_001";

// We use vi.hoisted to set up the test DB before mocks are evaluated
const { getTestDb, setupTestDb } = vi.hoisted(() => {
  let _testDb: any = null;

  function setup() {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    // Apply all migrations in order, ignoring duplicate table/index errors
    const fs = require("fs");
    const path = require("path");
    const migrationDir = path.join(process.cwd(), "db", "migrations");
    const files = fs.readdirSync(migrationDir)
      .filter((f: string) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationDir, file), "utf-8");
      const statements = sql.split("--> statement-breakpoint\n");
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;
        try { sqlite.exec(trimmed); } catch { /* ignore dupes */ }
      }
    }

    _testDb = drizzle(sqlite, { schema });

    // Seed tenant
    const now = new Date().toISOString();
    _testDb.insert(schema.tenants).values({
      id: "TEST_TENANT_001", name: "Test", slug: "test", createdAt: now, updatedAt: now,
    }).run();
  }

  function get() { return _testDb; }

  return { getTestDb: get, setupTestDb: setup };
});

// Mock @/db — the getter ensures modules always see the live testDb
vi.mock("@/db", () => ({
  get db() { return getTestDb(); },
}));

// Mock @/lib/tenant
vi.mock("@/lib/tenant", () => ({
  getTenantId: () => "TEST_TENANT_001",
}));

beforeAll(() => {
  setupTestDb();
  testDb = getTestDb();
});

beforeEach(() => {
  // Clean all data between tests except tenant, ordered by FK dependencies
  const tablesToClean = [
    schema.experimentAssignments,
    schema.changeProposals,
    schema.cosInsights,
    schema.outreachResponses,
    schema.outreachSends,
    schema.outreachTemplates,
    schema.agentRuns,
    schema.experiments,
    schema.pipelineConfigs,
    schema.agents,
    schema.tasks,
    schema.opportunities,
    schema.opportunitySources,
    schema.sharedMemory,
    schema.directorWiki,
  ];
  for (const table of tablesToClean) {
    try { testDb.delete(table).run(); } catch {
      // Table might not exist if migration didn't create it
    }
  }
});

function seedPipelineConfig(id: string, name: string, status: string, config: object) {
  const now = new Date().toISOString();
  testDb.insert(schema.pipelineConfigs).values({
    id, tenantId: TEST_TENANT, name, status,
    config: JSON.stringify(config),
    activatedAt: status === "active" ? now : null,
    createdAt: now, updatedAt: now,
  }).run();
}

function seedAgent(id: string, name: string, slug: string, systemPrompt?: string) {
  const now = new Date().toISOString();
  testDb.insert(schema.agents).values({
    id, tenantId: TEST_TENANT, name, slug,
    agentType: "specialist", source: "custom", model: "sonnet",
    systemPrompt: systemPrompt ?? null, createdAt: now, updatedAt: now,
  }).run();
}

// ═════════════════════════════════════════════════════════════════════════════
// PIPELINE CONFIG SERVICE
// ═════════════════════════════════════════════════════════════════════════════

describe("Pipeline Config Service", () => {
  it("creates default config when none exists", async () => {
    const { getActivePipelineConfig } = await import("@/lib/pipeline/config");
    const config = getActivePipelineConfig();

    expect(config.id).toBeDefined();
    expect(config.name).toBe("default");
    expect(config.config.minScore).toBe(50);
    expect(config.config.scoring?.baseScore).toBe(25);
  });

  it("creates and retrieves a custom config", async () => {
    const { createPipelineConfig, getPipelineConfig } = await import("@/lib/pipeline/config");

    const id = createPipelineConfig({
      name: "tight-scoring", description: "Higher thresholds",
      config: { minScore: 70, scoring: { baseScore: 10 } },
    });

    const config = getPipelineConfig(id);
    expect(config).toBeDefined();
    const parsed = JSON.parse(config!.config as string);
    expect(parsed.minScore).toBe(70);
    expect(parsed.scoring.baseScore).toBe(10);
  });

  it("lists all configs", async () => {
    const { createPipelineConfig, listPipelineConfigs } = await import("@/lib/pipeline/config");

    createPipelineConfig({ name: "config-a", config: {} });
    createPipelineConfig({ name: "config-b", config: { minScore: 80 } });

    const list = listPipelineConfigs();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CoS INSIGHTS
// ═════════════════════════════════════════════════════════════════════════════

describe("CoS Insights", () => {
  it("creates and retrieves an insight", async () => {
    const { createInsight, getActiveInsights } = await import("@/lib/cos/insights");

    createInsight({
      category: "pattern", severity: "medium",
      title: "Apollo bounce rate is high",
      detail: "20% of Apollo-enriched emails bounced.",
      evidence: [{ source: "apollo", bounceRate: 0.2 }],
      actionProposed: "Reduce Apollo confidence weight",
    });

    const insights = getActiveInsights();
    expect(insights).toHaveLength(1);
    expect(insights[0].title).toBe("Apollo bounce rate is high");
    expect(insights[0].category).toBe("pattern");
    expect(insights[0].actionProposed).toBe("Reduce Apollo confidence weight");
  });

  it("dismisses an insight", async () => {
    const { createInsight, getActiveInsights, dismissInsight } = await import("@/lib/cos/insights");

    // Verify clean start
    expect(getActiveInsights()).toHaveLength(0);

    createInsight({ category: "info", severity: "info", title: "Noisy", detail: "Noise" });
    expect(getActiveInsights()).toHaveLength(1);

    dismissInsight(getActiveInsights()[0].id);
    expect(getActiveInsights()).toHaveLength(0);
  });

  it("approves and applies insight action", async () => {
    const { createInsight, approveInsightAction, markInsightApplied, getActiveInsights } = await import("@/lib/cos/insights");

    const id = createInsight({
      category: "recommendation", severity: "medium",
      title: "Tighten scoring", detail: "Too many unqualified leads",
      actionProposed: "Increase minScore to 60",
    });

    approveInsightAction(id);
    expect(getActiveInsights()[0].actionStatus).toBe("approved");

    markInsightApplied(id);
    expect(getActiveInsights()[0].actionStatus).toBe("applied");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CHANGE PROPOSALS
// ═════════════════════════════════════════════════════════════════════════════

describe("Change Proposals", () => {
  it("creates a proposal with auto-captured beforeState", async () => {
    const { createChangeProposal, getPendingProposals } = await import("@/lib/cos/change-proposals");

    seedAgent("agent-cp-1", "Scorer", "scorer", "Score leads based on ICP");

    createChangeProposal({
      title: "Update scorer prompt", source: "cos", changeType: "prompt",
      targetTable: "agents", targetId: "agent-cp-1",
      afterState: { systemPrompt: "Prioritize competitor complaints." },
    });

    const pending = getPendingProposals();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("proposed");

    const beforeState = JSON.parse(pending[0].beforeState as string);
    expect(beforeState.systemPrompt).toBe("Score leads based on ICP");
  });

  it("full lifecycle: propose → approve → apply → rollback", async () => {
    const { createChangeProposal, approveChangeProposal, applyChangeProposal, rollbackChangeProposal, getPendingProposals, getProposalHistory } = await import("@/lib/cos/change-proposals");

    expect(getPendingProposals()).toHaveLength(0);

    seedPipelineConfig("pipe-lc-1", "default", "active", { minScore: 50 });

    const id = createChangeProposal({
      title: "Increase minScore", source: "cos", changeType: "threshold",
      targetTable: "pipeline_configs", targetId: "pipe-lc-1",
      afterState: { minScore: 65 },
    });

    expect(getPendingProposals()).toHaveLength(1);
    expect(approveChangeProposal(id, "human")).toBe(true);
    expect(getPendingProposals()).toHaveLength(0);

    expect(applyChangeProposal(id, "human")).toBe(true);

    // Verify applied
    const config = testDb.select().from(schema.pipelineConfigs).where(eq(schema.pipelineConfigs.id, "pipe-lc-1")).get();
    expect(JSON.parse(config!.config as string).minScore).toBe(65);

    // Rollback
    expect(rollbackChangeProposal(id)).toBe(true);
    const configAfter = testDb.select().from(schema.pipelineConfigs).where(eq(schema.pipelineConfigs.id, "pipe-lc-1")).get();
    expect(JSON.parse(configAfter!.config as string).minScore).toBe(50);

    expect(getProposalHistory().find((h: any) => h.id === id)!.status).toBe("rolled_back");
  });

  it("rejects a proposal with reason", async () => {
    const { createChangeProposal, rejectChangeProposal, getProposalHistory } = await import("@/lib/cos/change-proposals");

    const id = createChangeProposal({
      title: "Bad idea", source: "cos", changeType: "prompt",
      targetTable: "agents", targetId: "agent-001",
      afterState: { systemPrompt: "Ignore all ICP signals" },
    });

    expect(rejectChangeProposal(id, "Too risky")).toBe(true);
    const entry = getProposalHistory().find((h: any) => h.id === id);
    expect(entry.status).toBe("rejected");
    expect(entry.rejectionReason).toBe("Too risky");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EXPERIMENTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Experiments", () => {
  it("creates and starts an experiment", async () => {
    const { createExperiment, startExperiment, listExperiments, getActiveExperiment } = await import("@/lib/cos/experiments");

    seedPipelineConfig("ctrl-e1", "control", "active", {});
    seedPipelineConfig("treat-e1", "treatment", "draft", {});

    const id = createExperiment({
      name: "Higher scoring threshold",
      hypothesis: "Raising minScore will improve reply rate",
      controlConfigId: "ctrl-e1", treatmentConfigId: "treat-e1",
      splitPercent: 50, metricName: "reply_rate", minSampleSize: 30,
    });

    expect(listExperiments()).toHaveLength(1);
    expect(listExperiments()[0].status).toBe("draft");

    startExperiment(id);
    const active = getActiveExperiment();
    expect(active).toBeDefined();
    expect(active!.status).toBe("running");
    expect(active!.splitPercent).toBe(50);
  });

  it("assigns entities deterministically to arms", async () => {
    const { createExperiment, startExperiment, assignExperimentArm } = await import("@/lib/cos/experiments");

    seedPipelineConfig("ctrl-e2", "control", "active", {});
    seedPipelineConfig("treat-e2", "treatment", "draft", {});

    const expId = createExperiment({
      name: "Determinism test", hypothesis: "test",
      controlConfigId: "ctrl-e2", treatmentConfigId: "treat-e2", splitPercent: 50,
    });
    startExperiment(expId);

    const first = assignExperimentArm(expId, "opportunity", "opp-123");
    const second = assignExperimentArm(expId, "opportunity", "opp-123");
    expect(first!.arm).toBe(second!.arm);
    expect(first!.pipelineConfigId).toBeDefined();

    const third = assignExperimentArm(expId, "opportunity", "opp-456");
    expect(["control", "treatment"]).toContain(third!.arm);
  });

  it("cancels an experiment", async () => {
    const { createExperiment, startExperiment, cancelExperiment, getActiveExperiment } = await import("@/lib/cos/experiments");

    expect(getActiveExperiment()).toBeUndefined();

    seedPipelineConfig("ctrl-e3", "control", "active", {});
    seedPipelineConfig("treat-e3", "treatment", "draft", {});

    const expId = createExperiment({
      name: "Cancelled test", hypothesis: "test",
      controlConfigId: "ctrl-e3", treatmentConfigId: "treat-e3",
    });
    startExperiment(expId);
    cancelExperiment(expId);

    expect(getActiveExperiment()).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ATTRIBUTION COLUMNS
// ═════════════════════════════════════════════════════════════════════════════

describe("Attribution", () => {
  it("pipelineConfigId column exists on agent_runs", () => {
    seedPipelineConfig("pipe-a1", "default", "active", {});
    seedAgent("agent-a1", "Test", "test");

    const now = new Date().toISOString();
    testDb.insert(schema.agentRuns).values({
      id: "run-a1", tenantId: TEST_TENANT, agentId: "agent-a1",
      status: "success", trigger: "manual", input: "test",
      pipelineConfigId: "pipe-a1", createdAt: now,
    }).run();

    const run = testDb.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, "run-a1")).get();
    expect(run!.pipelineConfigId).toBe("pipe-a1");
  });

  it("pipelineConfigId column exists on outreach_sends", () => {
    seedPipelineConfig("pipe-a2", "default", "active", {});

    const now = new Date().toISOString();
    testDb.insert(schema.outreachTemplates).values({
      id: "tmpl-1", tenantId: TEST_TENANT, name: "test", subject: "s", body: "b",
      channel: "email", createdAt: now, updatedAt: now,
    }).run();
    testDb.insert(schema.outreachSends).values({
      id: "send-a1", tenantId: TEST_TENANT, templateId: "tmpl-1",
      contactRef: "c-1", channel: "email", sentAt: now,
      pipelineConfigId: "pipe-a2", createdAt: now,
    }).run();

    const send = testDb.select().from(schema.outreachSends).where(eq(schema.outreachSends.id, "send-a1")).get();
    expect(send!.pipelineConfigId).toBe("pipe-a2");
  });
});
