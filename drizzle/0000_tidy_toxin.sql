CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`request_key` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_request_key_unique` ON `orders` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_orders_owner` ON `orders` (`owner`);