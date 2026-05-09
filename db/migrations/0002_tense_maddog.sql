CREATE TABLE `desk_agents` (
	`desk_id` text NOT NULL,
	`agent_id` text NOT NULL,
	FOREIGN KEY (`desk_id`) REFERENCES `desks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desk_agents_unique` ON `desk_agents` (`desk_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `desks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`persona` text,
	`icon` text,
	`color` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desks_tenant_slug` ON `desks` (`tenant_id`,`slug`);--> statement-breakpoint
ALTER TABLE `copilot_conversations` ADD `desk_id` text REFERENCES desks(id);--> statement-breakpoint
ALTER TABLE `documents` ADD `desk_id` text REFERENCES desks(id);--> statement-breakpoint
ALTER TABLE `goals` ADD `desk_id` text REFERENCES desks(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `desk_id` text REFERENCES desks(id);