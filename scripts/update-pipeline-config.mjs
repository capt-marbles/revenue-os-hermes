#!/usr/bin/env node
/**
 * Update existing opportunities with new close probabilities and timeline expectations
 * Based on the evaluation period additions and extended decision cycles
 */

import Database from "better-sqlite3";
import { resolve } from "path";
import { getCloseProbability, calculateExpectedCloseDate, PIPELINE_CONFIG } from "../lib/pipeline/config.js";

const DB_PATH = resolve(process.cwd(), "data/revenue-os.db");
const db = Database(DB_PATH);

console.log("🔄 Updating CRM pipeline with new evaluation period and close probabilities...\n");

// Get current opportunity counts by stage
const currentStages = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM opportunities 
  WHERE tenant_id = '01JDEFAULT0000000000000000'
  GROUP BY status 
  ORDER BY count DESC
`).all();

console.log("📊 Current pipeline distribution:");
currentStages.forEach(stage => {
  const probability = getCloseProbability(stage.status);
  console.log(`  ${stage.status}: ${stage.count} opportunities (${probability}% close rate)`);
});

// Update opportunities that are in demo-related stages to evaluation_period
const demoCompleteUpdate = db.prepare(`
  UPDATE opportunities 
  SET 
    status = 'evaluation_period',
    metadata = json_set(
      COALESCE(metadata, '{}'), 
      '$.updated_for_evaluation_period', 
      datetime('now'),
      '$.original_status',
      status,
      '$.timeline_extended',
      'true',
      '$.reason',
      'Hathora June 30 deadline impact - extended evaluation cycles'
    ),
    updated_at = datetime('now')
  WHERE status IN ('demo_completed', 'technical_evaluation') 
    AND tenant_id = '01JDEFAULT0000000000000000'
`);

const demoUpdates = demoCompleteUpdate.run();
console.log(`\n✅ Moved ${demoUpdates.changes} opportunities from demo/technical stages to evaluation_period`);

// Add timeline adjustment notes to all active opportunities
const addTimelineNotes = db.prepare(`
  UPDATE opportunities 
  SET 
    metadata = json_set(
      COALESCE(metadata, '{}'),
      '$.deal_velocity_updated',
      datetime('now'),
      '$.timeline_expectation',
      'Extended to 30-60 days due to market conditions',
      '$.hathora_impact_noted',
      'true'
    ),
    updated_at = datetime('now')
  WHERE status NOT IN ('won', 'lost', 'archived', 'disqualified')
    AND tenant_id = '01JDEFAULT0000000000000000'
`);

const timelineUpdates = addTimelineNotes.run();
console.log(`✅ Added timeline expectation notes to ${timelineUpdates.changes} active opportunities`);

// Calculate and display new pipeline metrics
console.log("\n📈 Updated pipeline metrics:");

const updatedStages = db.prepare(`
  SELECT status, COUNT(*) as count, AVG(score) as avg_score
  FROM opportunities 
  WHERE tenant_id = '01JDEFAULT0000000000000000'
  GROUP BY status 
  ORDER BY count DESC
`).all();

let totalWeightedValue = 0;
updatedStages.forEach(stage => {
  const probability = getCloseProbability(stage.status);
  const weightedValue = stage.count * (probability / 100);
  totalWeightedValue += weightedValue;
  
  const stageConfig = PIPELINE_CONFIG.stages.find(s => s.id === stage.status);
  const expectedDays = stageConfig?.expectedDays || 7;
  
  console.log(`  ${stage.status.padEnd(20)}: ${stage.count.toString().padStart(3)} opps | ${probability.toString().padStart(2)}% close | ${expectedDays.toString().padStart(2)}d expected | ${weightedValue.toFixed(1)} weighted`);
});

console.log(`\n💰 Total weighted pipeline value: ${totalWeightedValue.toFixed(1)} opportunity equivalents`);
console.log(`📊 Average deal cycle: ${PIPELINE_CONFIG.averageDealCycleDays} days (extended from 90 days)`);

// Update any existing pipeline stage actions to reflect new timelines
const updatePipelineActions = db.prepare(`
  UPDATE pipeline_stage_actions 
  SET 
    prompt_template = REPLACE(
      prompt_template, 
      'Set a follow-up reminder for 5 business days',
      'Set a follow-up reminder for 2 weeks (10 business days) - extended timeline'
    ),
    updated_at = datetime('now')
  WHERE prompt_template LIKE '%5 business days%'
`);

const actionUpdates = updatePipelineActions.run();
console.log(`✅ Updated ${actionUpdates.changes} pipeline action templates with extended timelines`);

// Show summary of changes
console.log("\n🎯 Summary of CRM updates:");
console.log("  ✓ Added 'evaluation_period' stage after demo completion");
console.log("  ✓ Extended decision timeline from 7-14 days to 30-60 days"); 
console.log("  ✓ Recalibrated close probabilities for new market reality");
console.log("  ✓ Updated pipeline actions for longer follow-up cycles");
console.log("  ✓ Added Hathora deadline impact tracking to opportunity metadata");

console.log("\n📝 Next steps:");
console.log("  1. Review opportunities in evaluation_period stage weekly (not daily)");
console.log("  2. Adjust outreach cadence to be more consultative, less urgent");
console.log("  3. Monitor for opportunities stuck in evaluation > 60 days");
console.log("  4. Update sales forecasting models to use new close probabilities");

console.log("\n✨ CRM pipeline update complete!");

db.close();