import { desc, eq, and } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/db";
import { pipelineConfigs } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import {
  DEFAULT_PIPELINE_CONFIG,
  type ActivePipelineConfig,
  type PipelineConfig as RoutingPipelineConfig,
} from "./types";

/**
 * Pipeline stage configuration and close probability calculations
 * 
 * Updated for June 30 Hathora deadline impact:
 * - Extended evaluation periods (30-60 days vs 7-14 days)
 * - Recalibrated deal velocity assumptions
 * - Added evaluation_period stage after demo
 */

export interface PipelineStage {
  id: string;
  name: string;
  description: string;
  closeProbability: number;
  expectedDaysInStage: number;
  velocityMultiplier: number;
}

export interface SalesPipelineConfig {
  stages: PipelineStage[];
  averageDealCycleDays: number;
  lastUpdated: string;
}

/**
 * Updated pipeline configuration with new evaluation period stage
 * and extended timelines for studio decision cycles
 */
export const PIPELINE_CONFIG: SalesPipelineConfig = {
  lastUpdated: "2026-04-26",
  averageDealCycleDays: 120, // Extended from 90 days due to Hathora impact
  stages: [
    {
      id: "discovered",
      name: "Discovered",
      description: "New opportunity identified through signal or outreach",
      closeProbability: 5,
      expectedDaysInStage: 3,
      velocityMultiplier: 1.0
    },
    {
      id: "enriched", 
      name: "Enriched",
      description: "Company and contact research completed",
      closeProbability: 8,
      expectedDaysInStage: 2,
      velocityMultiplier: 1.0
    },
    {
      id: "scored",
      name: "Scored", 
      description: "ICP fit assessment and scoring completed",
      closeProbability: 12,
      expectedDaysInStage: 1,
      velocityMultiplier: 1.0
    },
    {
      id: "queued",
      name: "Queued",
      description: "Approved for outreach, email drafted",
      closeProbability: 15,
      expectedDaysInStage: 2,
      velocityMultiplier: 1.0
    },
    {
      id: "synced",
      name: "Synced",
      description: "Initial outreach sent, follow-up scheduled", 
      closeProbability: 20,
      expectedDaysInStage: 7,
      velocityMultiplier: 1.0
    },
    {
      id: "connected",
      name: "Connected",
      description: "Initial response received, conversation started",
      closeProbability: 35,
      expectedDaysInStage: 10,
      velocityMultiplier: 1.2
    },
    {
      id: "demo_scheduled",
      name: "Demo Scheduled", 
      description: "Product demonstration scheduled with prospect",
      closeProbability: 50,
      expectedDaysInStage: 7,
      velocityMultiplier: 1.3
    },
    {
      id: "demo_completed", 
      name: "Demo Completed",
      description: "Product demonstration completed, moving to evaluation",
      closeProbability: 60,
      expectedDaysInStage: 3,
      velocityMultiplier: 1.1
    },
    {
      id: "evaluation_period",
      name: "Evaluation Period",
      description: "Studio evaluating solution - extended timeline due to market conditions",
      closeProbability: 40, // Reduced from typical post-demo due to extended evaluation
      expectedDaysInStage: 45, // Extended from 14 days due to Hathora deadline impact
      velocityMultiplier: 0.6 // Slower velocity during extended evaluation
    },
    {
      id: "technical_evaluation",
      name: "Technical Evaluation",
      description: "Proof of concept or technical integration testing",
      closeProbability: 65,
      expectedDaysInStage: 21, // Extended from 14 days
      velocityMultiplier: 0.8
    },
    {
      id: "committed",
      name: "Committed", 
      description: "Verbal commitment received, working on contract terms",
      closeProbability: 85,
      expectedDaysInStage: 14,
      velocityMultiplier: 1.4
    },
    {
      id: "won",
      name: "Won",
      description: "Deal closed successfully",
      closeProbability: 100,
      expectedDaysInStage: 0,
      velocityMultiplier: 0
    },
    {
      id: "lost", 
      name: "Lost",
      description: "Deal lost to competitor or no decision",
      closeProbability: 0,
      expectedDaysInStage: 0,
      velocityMultiplier: 0
    }
  ]
};

type PipelineConfigRow = typeof pipelineConfigs.$inferSelect;

interface CreatePipelineConfigInput {
  name: string;
  description?: string;
  config?: RoutingPipelineConfig;
  status?: "draft" | "active" | "archived";
}

function nowIso() {
  return new Date().toISOString();
}

function parseConfig(config: string | null | undefined): RoutingPipelineConfig {
  if (!config) {
    return { ...DEFAULT_PIPELINE_CONFIG };
  }

  try {
    const parsed = JSON.parse(config) as RoutingPipelineConfig;
    return {
      ...DEFAULT_PIPELINE_CONFIG,
      ...parsed,
      scoring: {
        ...DEFAULT_PIPELINE_CONFIG.scoring,
        ...parsed.scoring,
      },
    };
  } catch {
    return { ...DEFAULT_PIPELINE_CONFIG };
  }
}

function ensureDefaultActiveConfig(tenantId: string): PipelineConfigRow {
  const existing = db
    .select()
    .from(pipelineConfigs)
    .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.status, "active")))
    .get();

  if (existing) {
    return existing;
  }

  const now = nowIso();
  const row: PipelineConfigRow = {
    id: ulid(),
    tenantId,
    name: "default",
    description: "System default pipeline config",
    status: "active",
    config: JSON.stringify(DEFAULT_PIPELINE_CONFIG),
    activatedAt: now,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(pipelineConfigs).values(row).run();
  return row;
}

function toActiveConfig(row: PipelineConfigRow): ActivePipelineConfig & {
  description: string | null;
  status: string;
} {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    config: parseConfig(row.config),
    activatedAt: row.activatedAt,
  };
}

export function getActivePipelineConfig(tenantId: string = getTenantId()) {
  return toActiveConfig(ensureDefaultActiveConfig(tenantId));
}

export function createPipelineConfig(input: CreatePipelineConfigInput, tenantId: string = getTenantId()) {
  const now = nowIso();
  const status = input.status ?? "draft";

  if (status === "active") {
    db.update(pipelineConfigs)
      .set({
        status: "archived",
        deactivatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.status, "active")))
      .run();
  }

  const id = ulid();
  db.insert(pipelineConfigs)
    .values({
      id,
      tenantId,
      name: input.name,
      description: input.description ?? null,
      status,
      config: JSON.stringify(input.config ?? DEFAULT_PIPELINE_CONFIG),
      activatedAt: status === "active" ? now : null,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return id;
}

export function getPipelineConfig(id: string, tenantId: string = getTenantId()) {
  return db
    .select()
    .from(pipelineConfigs)
    .where(and(eq(pipelineConfigs.id, id), eq(pipelineConfigs.tenantId, tenantId)))
    .get() ?? null;
}

export function listPipelineConfigs(tenantId: string = getTenantId()) {
  return db
    .select()
    .from(pipelineConfigs)
    .where(eq(pipelineConfigs.tenantId, tenantId))
    .orderBy(desc(pipelineConfigs.updatedAt))
    .all();
}

export function resolvePipelineConfigForOpportunity(_opportunityId: string, tenantId: string) {
  return getActivePipelineConfig(tenantId);
}

/**
 * Get close probability for a given stage
 */
export function getCloseProbability(stageId: string): number {
  const stage = PIPELINE_CONFIG.stages.find(s => s.id === stageId);
  return stage?.closeProbability ?? 0;
}

/**
 * Get expected days in stage
 */
export function getExpectedDaysInStage(stageId: string): number {
  const stage = PIPELINE_CONFIG.stages.find(s => s.id === stageId);
  return stage?.expectedDaysInStage ?? 7;
}

/**
 * Calculate weighted close probability based on time in stage
 * Adjusts probability based on how long deal has been in current stage
 */
export function calculateWeightedProbability(
  stageId: string, 
  daysInStage: number
): number {
  const baseProbability = getCloseProbability(stageId);
  const expectedDays = getExpectedDaysInStage(stageId);
  
  if (daysInStage <= expectedDays) {
    return baseProbability;
  }
  
  // Reduce probability for deals that are stale
  const staleFactor = Math.min(daysInStage / expectedDays, 3.0);
  const adjustedProbability = baseProbability * (1 - (staleFactor - 1) * 0.2);
  
  return Math.max(adjustedProbability, baseProbability * 0.3);
}

/**
 * Calculate expected close date based on current stage and velocity
 */
export function calculateExpectedCloseDate(
  stageId: string,
  currentDate: Date = new Date()
): Date {
  const currentStageIndex = PIPELINE_CONFIG.stages.findIndex(s => s.id === stageId);
  if (currentStageIndex === -1) return currentDate;
  
  let totalDays = 0;
  for (let i = currentStageIndex; i < PIPELINE_CONFIG.stages.length; i++) {
    const stage = PIPELINE_CONFIG.stages[i];
    if (stage.id === "won" || stage.id === "lost") break;
    totalDays += stage.expectedDaysInStage * stage.velocityMultiplier;
  }
  
  const closeDate = new Date(currentDate);
  closeDate.setDate(closeDate.getDate() + Math.ceil(totalDays));
  return closeDate;
}

/**
 * Get stage progression mapping for Twenty CRM
 */
export const TWENTY_STAGE_MAP = {
  "TARGET_ACCOUNT": "discovered",
  "SIGNAL_RECEIVED": "enriched", 
  "REACHOUT": "synced",
  "DEMO_SCHEDULED": "demo_scheduled",
  "DEMO_COMPLETED": "demo_completed",
  "EVALUATION_PERIOD": "evaluation_period",
  "TECHNICAL_EVALUATION": "technical_evaluation",
  "CONNECTED": "connected",
  "COMMITTED": "committed", 
  "WON": "won",
  "LOST": "lost"
} as const;

/**
 * Reverse mapping from internal stage to Twenty CRM stage
 */
export const INTERNAL_TO_TWENTY_STAGE = Object.fromEntries(
  Object.entries(TWENTY_STAGE_MAP).map(([k, v]) => [v, k])
) as Record<string, string>;
