-- Migration: Add evaluation period stage and update deal velocity tracking
-- Adds new pipeline stages and velocity configuration for extended decision cycles

-- Add new opportunity status values for the evaluation period
-- Note: This assumes the status field already exists as text type

-- Insert pipeline stage configuration for evaluation period
INSERT OR REPLACE INTO pipeline_stage_actions (id, tenant_id, name, description, from_status, to_status, agent_id, prompt_template, auto_approve, priority, status, created_at, updated_at)
VALUES 
  ('01PSA_EVALUATION_START', '01JDEFAULT0000000000000000',
   'Steward: Begin evaluation period tracking',
   'When demo is completed, move to evaluation period with extended timeline.',
   'demo_completed', 'evaluation_period',
   '01STEWARD0000000000000000',
   'Demo completed for {{opportunityTitle}}. Moving to evaluation period.

Extended Timeline Notice:
- Previous expectation: 7-14 day decisions  
- Current reality: 30-60 day evaluation cycles due to Hathora June 30 deadline impact

Actions required:
1. Set status to "evaluation_period"
2. Update close probability to 40% (baseline for evaluation stage)
3. Set follow-up for 14 days (not 5 business days)  
4. Add note: "Extended eval cycle - market conditions require longer assessment"
5. Adjust expected close date to +45 days from today

This reflects the strategic shift where studios need more time to evaluate alternatives before committing.',
   1, 8, 'active', datetime('now'), datetime('now')),

  ('01PSA_EVALUATION_FOLLOWUP', '01JDEFAULT0000000000000000', 
   'Steward: Evaluation period check-in',
   'Mid-evaluation follow-up to maintain engagement during extended cycle.',
   'evaluation_period', 'evaluation_period',
   '01STEWARD0000000000000000',
   'Evaluation period check-in for {{opportunityTitle}}.

It has been 2+ weeks since demo completion. Time for a strategic follow-up:

1. Send soft check-in email focusing on addressing any blockers
2. Offer technical resources or additional demos if needed  
3. Remind of Hathora deadline relevance (June 30) without being pushy
4. Update opportunity notes with any new intelligence
5. Assess if timeline needs further adjustment

Tone should be helpful and consultative - we are here to support their evaluation process, not rush their decision.',
   0, 5, 'active', datetime('now'), datetime('now')),

  ('01PSA_EVALUATION_STALE', '01JDEFAULT0000000000000000',
   'Steward: Flag stale evaluation', 
   'Flag opportunities stuck in evaluation beyond expected timeframe.',
   'evaluation_period', '',
   '01STEWARD0000000000000000',
   'ALERT: Evaluation period exceeded normal timeframe for {{opportunityTitle}}.

Timeline exceeded: 60+ days in evaluation period.

Actions needed:
1. Reassess opportunity viability - is this still active?
2. Reach out to determine current status and blockers
3. Consider if this should be moved to "lost" or "on hold" 
4. Update close probability based on current intel
5. Document lessons learned about evaluation cycle length

This extended timeline may indicate changing priorities or budget constraints.',
   0, 3, 'active', datetime('now'), datetime('now'));