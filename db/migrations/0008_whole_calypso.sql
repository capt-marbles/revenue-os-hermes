CREATE TABLE `agent_session_state` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text,
	`session_summary` text NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`last_run_id` text,
	`last_run_status` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_state_agent_task` ON `agent_session_state` (`tenant_id`,`agent_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `briefing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`summary_markdown` text NOT NULL,
	`structured_payload` text DEFAULT '{}' NOT NULL,
	`queue_count` integer DEFAULT 0 NOT NULL,
	`top_opportunity_id` text,
	`freshness_label` text DEFAULT 'fresh' NOT NULL,
	`generated_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`top_opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `briefing_snapshots_tenant_date` ON `briefing_snapshots` (`tenant_id`,`snapshot_date`);--> statement-breakpoint
CREATE TABLE `change_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`change_type` text NOT NULL,
	`target_table` text NOT NULL,
	`target_id` text NOT NULL,
	`before_state` text DEFAULT '{}' NOT NULL,
	`after_state` text DEFAULT '{}' NOT NULL,
	`experiment_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`approved_by` text,
	`applied_by` text,
	`applied_at` text,
	`rejection_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `copilot_action_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`action_key` text NOT NULL,
	`status` text NOT NULL,
	`result_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `copilot_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `copilot_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copilot_action_decisions_unique` ON `copilot_action_decisions` (`tenant_id`,`message_id`,`action_key`);--> statement-breakpoint
CREATE TABLE `cos_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`action_proposed` text,
	`action_status` text DEFAULT 'null',
	`status` text DEFAULT 'active' NOT NULL,
	`experiment_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `experiment_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`experiment_id` text NOT NULL,
	`arm` text NOT NULL,
	`pipeline_config_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_config_id`) REFERENCES `pipeline_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exp_assign_entity` ON `experiment_assignments` (`experiment_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`hypothesis` text NOT NULL,
	`control_config_id` text NOT NULL,
	`treatment_config_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`split_percent` integer DEFAULT 50 NOT NULL,
	`metric_name` text NOT NULL,
	`metric_direction` text DEFAULT 'higher_is_better' NOT NULL,
	`start_date` text,
	`end_date` text,
	`sample_size` integer DEFAULT 0 NOT NULL,
	`min_sample_size` integer DEFAULT 50 NOT NULL,
	`control_metric_value` real,
	`treatment_metric_value` real,
	`confidence` real,
	`conclusion` text,
	`concluded_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`control_config_id`) REFERENCES `pipeline_configs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`treatment_config_id`) REFERENCES `pipeline_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `intro_paths` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`connector_type` text NOT NULL,
	`mutual_ref` text,
	`mutual_name` text,
	`path_summary` text NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`freshness` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`evidence` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`goal_id` text,
	`title` text NOT NULL,
	`account_name` text,
	`primary_contact_name` text,
	`primary_contact_email` text,
	`primary_contact_linkedin` text,
	`opportunity_type` text DEFAULT 'outbound' NOT NULL,
	`status` text DEFAULT 'discovered' NOT NULL,
	`primary_path` text DEFAULT 'none' NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`rationale_summary` text,
	`source_summary` text,
	`freshest_signal_at` text,
	`last_activity_at` text,
	`attio_record_ref` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_tenant_title_account_contact` ON `opportunities` (`tenant_id`,`title`,`account_name`,`primary_contact_email`);--> statement-breakpoint
CREATE TABLE `opportunity_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`draft_type` text NOT NULL,
	`subject` text,
	`content` text NOT NULL,
	`model_ref` text,
	`status` text DEFAULT 'generated' NOT NULL,
	`approved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `opportunity_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`outcome_type` text NOT NULL,
	`attributed_source` text,
	`attributed_template` text,
	`attribution_confidence` real DEFAULT 0 NOT NULL,
	`notes` text,
	`recorded_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `opportunity_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`payload_fingerprint` text,
	`freshness_score` real DEFAULT 0 NOT NULL,
	`raw_summary` text,
	`source_evidence` text DEFAULT '{}' NOT NULL,
	`ingested_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_sources_unique_ref` ON `opportunity_sources` (`tenant_id`,`source_type`,`source_ref`);--> statement-breakpoint
CREATE TABLE `opportunity_sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`target_system` text NOT NULL,
	`action_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_ref` text,
	`payload_summary` text,
	`error_class` text,
	`error_message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pipeline_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`activated_at` text,
	`deactivated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`scope` text DEFAULT 'global' NOT NULL,
	`target_agent_id` text,
	`conditions` text DEFAULT '{}' NOT NULL,
	`actions` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`filter_config` text DEFAULT '{}' NOT NULL,
	`schedule_config` text DEFAULT '{}' NOT NULL,
	`dedupe_key_strategy` text DEFAULT '',
	`last_fired_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `memory_tenant_category_key`;--> statement-breakpoint
ALTER TABLE `shared_memory` ADD `layer` text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE `shared_memory` ADD `scope_ref_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `shared_memory` ADD `confidence` real DEFAULT 1;--> statement-breakpoint
CREATE UNIQUE INDEX `memory_tenant_layer_scope_category_key` ON `shared_memory` (`tenant_id`,`layer`,`scope_ref_id`,`category`,`key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`desk_id` text,
	`goal_id` text,
	`parent_task_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`approval_mode` text DEFAULT 'none' NOT NULL,
	`approval_status` text DEFAULT 'approved' NOT NULL,
	`assignee_type` text DEFAULT 'unassigned',
	`assignee_id` text,
	`priority` text DEFAULT 'medium',
	`position` integer DEFAULT 0,
	`depth` integer DEFAULT 0,
	`timeout_seconds` integer,
	`due_date` text,
	`tags` text DEFAULT '[]',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`desk_id`) REFERENCES `desks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "tenant_id", "desk_id", "goal_id", "parent_task_id", "title", "description", "status", "source", "approval_mode", "approval_status", "assignee_type", "assignee_id", "priority", "position", "depth", "timeout_seconds", "due_date", "tags", "created_at", "updated_at") SELECT "id", "tenant_id", "desk_id", "goal_id", "parent_task_id", "title", "description", "status", "source", "approval_mode", "approval_status", "assignee_type", "assignee_id", "priority", "position", "depth", "timeout_seconds", "due_date", "tags", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `pipeline_config_id` text REFERENCES pipeline_configs(id);--> statement-breakpoint
ALTER TABLE `agents` ADD `agent_type` text DEFAULT 'specialist' NOT NULL;--> statement-breakpoint
ALTER TABLE `copilot_conversations` ADD `owner_agent_id` text REFERENCES agents(id);--> statement-breakpoint
ALTER TABLE `outreach_sends` ADD `pipeline_config_id` text REFERENCES pipeline_configs(id);