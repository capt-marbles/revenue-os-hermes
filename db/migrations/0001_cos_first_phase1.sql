ALTER TABLE `agents` ADD `agent_type` text DEFAULT 'specialist' NOT NULL;
--> statement-breakpoint
ALTER TABLE `shared_memory` ADD `layer` text DEFAULT 'global' NOT NULL;
--> statement-breakpoint
ALTER TABLE `shared_memory` ADD `scope_ref_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `shared_memory` ADD `confidence` real DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `copilot_conversations` ADD `owner_agent_id` text REFERENCES `agents`(`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_tenant_layer_scope_category_key` ON `shared_memory` (`tenant_id`,`layer`,`scope_ref_id`,`category`,`key`);
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
