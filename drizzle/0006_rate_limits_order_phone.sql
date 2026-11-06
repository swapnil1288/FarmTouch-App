CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limits_window` ON `rate_limits` (`window_start`);--> statement-breakpoint
ALTER TABLE `orders` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_phone` ON `orders` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_orders_created` ON `orders` (`created_at`);--> statement-breakpoint
UPDATE `orders` SET `phone` = COALESCE(json_extract(`payload`, '$.address.phone'), '') WHERE `phone` = '';