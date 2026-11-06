CREATE TABLE `coupons` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`min` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`expires_at` text,
	`first_order_only` integer DEFAULT false NOT NULL,
	`per_customer` integer DEFAULT 0 NOT NULL,
	`max_uses` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "coupons_amount_positive" CHECK("coupons"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE `service_pincodes` (
	`pin` text PRIMARY KEY NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slot_days` (
	`date` text PRIMARY KEY NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`capacity` integer,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `coupon` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_coupon` ON `orders` (`coupon`);--> statement-breakpoint
UPDATE `orders` SET `coupon` = COALESCE(json_extract(`payload`, '$.coupon'), '') WHERE `coupon` = '';
--> statement-breakpoint
INSERT OR IGNORE INTO `coupons` (`code`, `title`, `amount`, `min`, `active`, `expires_at`, `first_order_only`, `per_customer`, `max_uses`, `created_at`, `updated_at`) VALUES
	('FRESH50', 'A fresh start', 50, 499, 1, NULL, 0, 0, 0, '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z'),
	('BASKET75', 'Stock up & save', 75, 799, 1, NULL, 0, 0, 0, '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z');
