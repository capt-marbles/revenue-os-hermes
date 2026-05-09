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
CREATE UNIQUE INDEX `opportunities_tenant_title_account_contact` ON `opportunities` (`tenant_id`,`title`,`account_name`,`primary_contact_email`);
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
CREATE UNIQUE INDEX `opportunity_sources_unique_ref` ON `opportunity_sources` (`tenant_id`,`source_type`,`source_ref`);
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
CREATE UNIQUE INDEX `briefing_snapshots_tenant_date` ON `briefing_snapshots` (`tenant_id`,`snapshot_date`);
