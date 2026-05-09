ALTER TABLE `shared_memory` ADD COLUMN `layer` text NOT NULL DEFAULT 'global';
--> statement-breakpoint
ALTER TABLE `shared_memory` ADD COLUMN `scope_ref_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `shared_memory` ADD COLUMN `confidence` real DEFAULT 1;
--> statement-breakpoint
DROP INDEX IF EXISTS `memory_tenant_category_key`;
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_tenant_layer_scope_category_key`
  ON `shared_memory` (`tenant_id`, `layer`, `scope_ref_id`, `category`, `key`);
