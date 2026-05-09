CREATE TABLE IF NOT EXISTS `autopilots` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `name` text NOT NULL,
  `description` text,
  `agent_slug` text NOT NULL,
  `prompt` text NOT NULL,
  `schedule` text NOT NULL,
  `mode` text NOT NULL DEFAULT 'run_only',
  `enabled` integer NOT NULL DEFAULT 1,
  `last_run_at` text,
  `next_run_at` text,
  `last_run_status` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `autopilot_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `autopilot_id` text NOT NULL REFERENCES `autopilots`(`id`),
  `status` text NOT NULL DEFAULT 'queued',
  `trigger` text NOT NULL DEFAULT 'scheduled',
  `prompt` text NOT NULL,
  `output` text,
  `error` text,
  `started_at` text,
  `completed_at` text,
  `duration_ms` integer,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_autopilots_tenant` ON `autopilots`(`tenant_id`);
CREATE INDEX IF NOT EXISTS `idx_autopilot_runs_autopilot` ON `autopilot_runs`(`autopilot_id`);
