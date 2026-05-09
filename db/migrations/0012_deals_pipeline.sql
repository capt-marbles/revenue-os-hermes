CREATE TABLE `deals` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `name` text NOT NULL,
  `stage` text NOT NULL DEFAULT 'discovered',
  `sales_motion` text NOT NULL DEFAULT 'outbound',
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
  `updated_at` text NOT NULL
);

CREATE INDEX `deals_tenant_stage` ON `deals` (`tenant_id`, `stage`);

CREATE TABLE `deal_activities` (
  `id` text PRIMARY KEY NOT NULL,
  `deal_id` text NOT NULL REFERENCES `deals`(`id`) ON DELETE CASCADE,
  `content` text NOT NULL,
  `type` text NOT NULL DEFAULT 'note',
  `created_at` text NOT NULL
);

CREATE INDEX `deal_activities_deal` ON `deal_activities` (`deal_id`);
