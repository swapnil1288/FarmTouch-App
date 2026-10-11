CREATE TABLE `order_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_order_events_order` ON `order_events` (`order_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`local` text DEFAULT '' NOT NULL,
	`unit` text NOT NULL,
	`price` integer NOT NULL,
	`mrp` integer NOT NULL,
	`category` text NOT NULL,
	`image` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL,
	CONSTRAINT "products_stock_non_negative" CHECK("products"."stock" >= 0),
	CONSTRAINT "products_price_positive" CHECK("products"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `status` text DEFAULT 'placed' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `slot` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `assignee` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `packed` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `cash_collected` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_slot` ON `orders` (`slot`);--> statement-breakpoint
CREATE INDEX `idx_orders_assignee` ON `orders` (`assignee`);--> statement-breakpoint
-- Backfill workflow columns for orders saved before v3.
UPDATE `orders` SET
	`slot` = COALESCE(json_extract(`payload`, '$.slot'), ''),
	`total` = COALESCE(json_extract(`payload`, '$.totals.total'), 0),
	`updated_at` = `created_at`;--> statement-breakpoint
INSERT INTO `order_events` (`order_id`, `status`, `action`, `actor`, `note`, `created_at`)
	SELECT `id`, 'placed', 'placed', 'customer', NULL, `created_at` FROM `orders`;--> statement-breakpoint
-- Starter catalogue (edit prices and stock from /admin → Products).
INSERT OR IGNORE INTO `products` (`id`, `name`, `local`, `unit`, `price`, `mrp`, `category`, `image`, `stock`, `active`, `sort`, `updated_at`) VALUES
	('tomato', 'Tomato', 'Tamatar · टोमॅटो', '500 g', 40, 50, 'Vegetables', 'tomato', 100, 1, 1, '2026-10-07T00:00:00.000Z'),
	('carrot', 'Carrot', 'Gajar · गाजर', '500 g', 32, 40, 'Vegetables', 'carrot', 100, 1, 2, '2026-10-07T00:00:00.000Z'),
	('potato', 'Potato', 'Aloo · बटाटा', '1 kg', 35, 40, 'Vegetables', 'potato', 100, 1, 3, '2026-10-07T00:00:00.000Z'),
	('onion', 'Onion', 'Pyaz · Kanda · कांदा', '1 kg', 38, 45, 'Vegetables', 'onion', 100, 1, 4, '2026-10-07T00:00:00.000Z'),
	('spinach', 'Spinach', 'Palak · पालक', '1 bunch', 25, 30, 'Greens', 'spinach', 60, 1, 5, '2026-10-07T00:00:00.000Z'),
	('okra', 'Bhindi', 'Okra · भेंडी', '500 g', 45, 50, 'Vegetables', 'okra', 60, 1, 6, '2026-10-07T00:00:00.000Z'),
	('banana', 'Banana', 'Kela · केळी', '6 pcs', 50, 60, 'Fruits', 'banana', 60, 1, 7, '2026-10-07T00:00:00.000Z'),
	('apple', 'Apple', 'Seb · सफरचंद', '500 g', 90, 110, 'Fruits', 'apple', 60, 1, 8, '2026-10-07T00:00:00.000Z');
