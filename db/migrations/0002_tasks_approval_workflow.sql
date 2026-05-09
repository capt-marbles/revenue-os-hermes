ALTER TABLE `tasks` ADD `source` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `approval_mode` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `approval_status` text DEFAULT 'approved' NOT NULL;
