CREATE TABLE `director_wiki` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`desk_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]',
	`source_run_ids` text DEFAULT '[]',
	`confidence` text DEFAULT 'medium',
	`last_referenced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`desk_id`) REFERENCES `desks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_tenant_desk_slug` ON `director_wiki` (`tenant_id`,`desk_id`,`slug`);