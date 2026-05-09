-- Seed default pipeline stage actions and specialist agents.
-- Run this after migration 0009.

-- Ensure specialist agents exist (they have desks but may not have agent records)
INSERT OR IGNORE INTO agents (id, tenant_id, name, slug, description, system_prompt, model, tools, status, agent_type, source, created_at, updated_at)
VALUES
  ('01SCOUT000000000000000000', '01JDEFAULT0000000000000000', 'Scout', 'scout',
   'Prospect researcher and lead finder. Discovers and enriches opportunities.',
   'You are Scout, the prospect researcher for Gameye. Your job is to find multiplayer game studios that could benefit from Gameye''s infrastructure. When given a task, research the company, find key contacts, and assess fit against the ICP. Be thorough but efficient. Report your findings concisely.',
   'sonnet', '["web_search", "apollo", "hunter"]', 'idle', 'specialist', 'seed', datetime('now'), datetime('now')),

  ('01OUTREACH000000000000000', '01JDEFAULT0000000000000000', 'Outreach', 'outreach',
   'Email draft specialist. Creates personalized outreach based on prospect research.',
   'You are Outreach — the outreach specialist for Gameye. Your job is to craft personalized cold emails and intro requests based on prospect research. Use the prospect''s pain points, recent signals, and company context to write emails that get replies. Follow the brand voice guidelines. Every email should feel like it was written by a human who did their homework.',
   'sonnet', '["draft_email", "templates"]', 'idle', 'specialist', 'seed', datetime('now'), datetime('now')),

  ('01STEWARD0000000000000000', '01JDEFAULT0000000000000000', 'Steward', 'steward',
   'CRM hygiene and deal management. Keeps pipeline data accurate and up to date.',
   'You are Steward, the CRM specialist for Gameye. Your job is to keep the pipeline clean and accurate. When told a deal has moved, update the records. When data goes stale, flag it. Your nagging is gentle but persistent — good CRM data means better decisions. Always explain why the data matters.',
   'sonnet', '["crm_update", "notes"]', 'idle', 'specialist', 'seed', datetime('now'), datetime('now'));

-- Default pipeline stage actions
-- 1. When an opportunity is created (discovered), Scout should start researching
INSERT OR IGNORE INTO pipeline_stage_actions (id, tenant_id, name, description, from_status, to_status, agent_id, prompt_template, auto_approve, priority, status, created_at, updated_at)
VALUES
  ('01PSA_SCOUT_DISCOVERED', '01JDEFAULT0000000000000000',
   'Scout: Research new opportunity',
   'When a new opportunity is discovered, Scout researches the company and enriches the profile.',
   '', 'enriched',
   '01SCOUT000000000000000000',
   'A new opportunity needs enrichment: {{opportunityTitle}} ({{opportunityId}}).

Account: {{accountName}}
Contact: {{contactName}}
Score: {{score}}/100

Research this company. Find:
1. What multiplayer games they make / their tech stack
2. Key decision makers (not just the contact we have)
3. Any known infrastructure challenges or competitor usage signals
4. Recent news that makes this a good time to reach out

Report your findings. If this doesn''t look like a fit, say why.',
   1, 10, 'active', datetime('now'), datetime('now')),

  -- 2. When opportunity is scored/qualified, Outreach writes the first email
  ('01PSA_OUTREACH_SCORED', '01JDEFAULT0000000000000000',
   'Outreach: Write initial outreach',
   'When an opportunity reaches scored/queued status, Outreach crafts the cold email.',
   '', 'queued',
   '01OUTREACH000000000000000',
   'An opportunity is ready for outreach: {{opportunityTitle}} ({{opportunityId}}).

Account: {{accountName}}
Contact: {{contactName}}
Score: {{score}}/100
Rationale: {{rationale}}

Write a personalized cold email. Keep it short (under 150 words). Lead with what we know about their situation. Make the ask specific. The tone should be helpful, not salesy — we''re reaching out because we genuinely think we can help with their multiplayer infrastructure.',
   1, 10, 'active', datetime('now'), datetime('now')),

  -- 3. When demo is completed, move to evaluation period and set long timeline expectations
  ('01PSA_STEWARD_DEMO_COMPLETE', '01JDEFAULT0000000000000000',
   'Steward: Setup evaluation period tracking',
   'When a demo is completed, transition to evaluation period with 30-60 day timeline.',
   'demo_completed', 'evaluation_period',
   '01STEWARD0000000000000000',
   'Demo has been completed for: {{opportunityTitle}} ({{opportunityId}}).

Account: {{accountName}}
Contact: {{contactName}}

The prospect is now entering their evaluation period. Based on June 30 Hathora deadline impact, studios are taking 30-60 days for decisions instead of the previous 7-14 day expectations.

Please:
1. Update the CRM to reflect "Evaluation Period" status
2. Set follow-up reminder for 2 weeks from now (not 5 business days)
3. Note the longer decision timeline in the opportunity notes
4. Adjust close probability to 40% (evaluation stage baseline)
5. Set expected close date to 45 days from today

This strategic evaluation period reflects the new market reality where studios need more time to assess alternatives.',
   1, 8, 'active', datetime('now'), datetime('now')),

  -- 4. When a draft is approved and synced, Steward logs the interaction  
  ('01PSA_STEWARD_SYNCED', '01JDEFAULT0000000000000000',
   'Steward: Log outreach and set follow-up',
   'When outreach is synced, Steward ensures CRM is up to date and a follow-up is scheduled.',
   '', 'synced',
   '01STEWARD0000000000000000',
   'Outreach has been sent for: {{opportunityTitle}} ({{opportunityId}}).

Account: {{accountName}}
Contact: {{contactName}}

The email was approved and synced. Please:
1. Verify the CRM record is complete (account, contact, deal stage)
2. Set a follow-up reminder for 5 business days from now
3. Note any data that needs updating',
   0, 5, 'active', datetime('now'), datetime('now'));

-- ─── Cron Trigger: Scout Daily Prospect Scan ───────────────────────────────
-- Runs weekdays at 6am CT. Scout checks Steam DB for new multiplayer titles.
INSERT OR IGNORE INTO triggers (id, tenant_id, name, type, status, target_type, target_id, schedule_config, filter_config, created_at, updated_at)
VALUES ('01TRG_SCOUT_DAILY', '01JDEFAULT0000000000000000', 'Scout: Daily prospect scan', 'cron', 'active', 'specialist', '01SCOUT0000000000000000',
  '{"cron":"0 6 * * 1-5","input":"Run the daily prospect scan. Check Steam DB for newly released or recently updated multiplayer games. Score and enrich any new leads. Focus on indie studios (10-500 employees) with active multiplayer titles."}',
  '{}', datetime('now'), datetime('now'));
