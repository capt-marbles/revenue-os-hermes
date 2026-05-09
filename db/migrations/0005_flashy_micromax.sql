ALTER TABLE `goals` ADD `approval_mode` text DEFAULT 'each';--> statement-breakpoint
ALTER TABLE `tasks` ADD `parent_task_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `approval_status` text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `tasks` ADD `depth` integer DEFAULT 0;