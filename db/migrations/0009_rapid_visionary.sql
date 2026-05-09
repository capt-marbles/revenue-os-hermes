-- Pipeline stage triggers
-- Adds stage_transition_actions table to define what happens when opportunities move between stages.
-- Wires into the existing trigger system.

-- Table: pipeline_stage_actions
-- Defines which agent runs when an opportunity transitions from one status to another.
CREATE TABLE IF NOT EXISTS `pipeline_stage_actions` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `name` text NOT NULL,
  `description` text,
  `from_status` text NOT NULL DEFAULT '*',
  `to_status` text NOT NULL,
  `agent_id` text NOT NULL REFERENCES `agents`(`id`),
  `prompt_template` text NOT NULL,
  `auto_approve` integer NOT NULL DEFAULT 0,
  `priority` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_psa_tenant_status` ON `pipeline_stage_actions`(`tenant_id`, `status`);
CREATE INDEX IF NOT EXISTS `idx_psa_transition` ON `pipeline_stage_actions`(`tenant_id`, `from_status`, `to_status`, `status`);
