CREATE TABLE `autopilot_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`autopilot_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger` text DEFAULT 'scheduled' NOT NULL,
	`prompt` text NOT NULL,
	`output` text,
	`error` text,
	`started_at` text,
	`completed_at` text,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`autopilot_id`) REFERENCES `autopilots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `autopilots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`agent_slug` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`mode` text DEFAULT 'run_only' NOT NULL,
	`harness` text DEFAULT 'hermes' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_run_at` text,
	`next_run_at` text,
	`last_run_status` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deal_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`content` text NOT NULL,
	`type` text DEFAULT 'note' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deal_activities_deal` ON `deal_activities` (`deal_id`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`stage` text DEFAULT 'reachout' NOT NULL,
	`sales_motion` text DEFAULT 'outbound' NOT NULL,
	`contact_name` text,
	`contact_email` text,
	`close_date` text,
	`mrr` real,
	`revenue_date` text,
	`studio_name` text,
	`notes` text,
	`position` integer DEFAULT 0,
	`twenty_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deals_tenant_stage` ON `deals` (`tenant_id`,`stage`);--> statement-breakpoint
CREATE TABLE `document_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`document_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pipeline_stage_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`from_status` text DEFAULT '*' NOT NULL,
	`to_status` text NOT NULL,
	`agent_id` text NOT NULL,
	`prompt_template` text NOT NULL,
	`auto_approve` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cos_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`action_proposed` text,
	`action_status` text,
	`status` text DEFAULT 'active' NOT NULL,
	`experiment_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_cos_insights`("id", "tenant_id", "category", "severity", "title", "detail", "evidence", "action_proposed", "action_status", "status", "experiment_id", "created_at", "updated_at") SELECT "id", "tenant_id", "category", "severity", "title", "detail", "evidence", "action_proposed", "action_status", "status", "experiment_id", "created_at", "updated_at" FROM `cos_insights`;--> statement-breakpoint
DROP TABLE `cos_insights`;--> statement-breakpoint
ALTER TABLE `__new_cos_insights` RENAME TO `cos_insights`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `copilot_messages` ADD `status` text DEFAULT 'done';