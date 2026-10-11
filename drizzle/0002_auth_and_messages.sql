CREATE TABLE `customers` (
	`phone` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updates_opt_in` integer DEFAULT true NOT NULL,
	`offers_opt_in` integer DEFAULT false NOT NULL,
	`orders_count` integer DEFAULT 0 NOT NULL,
	`last_order_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text,
	`phone` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`wa_message_id` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	`sent_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_order` ON `notifications` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_status` ON `notifications` (`status`);--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_staff_sessions_email` ON `staff_sessions` (`email`);--> statement-breakpoint
ALTER TABLE `staff` ADD `password_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `staff` ADD `failed_logins` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `staff` ADD `locked_until` text;--> statement-breakpoint
CREATE INDEX `idx_staff_phone` ON `staff` (`phone`);--> statement-breakpoint
-- Customers from existing orders (WhatsApp order updates follow their checkout choice; offers need a fresh opt-in).
INSERT OR IGNORE INTO `customers` (`phone`, `name`, `updates_opt_in`, `offers_opt_in`, `orders_count`, `last_order_at`, `updated_at`)
	SELECT json_extract(`payload`, '$.address.phone'), COALESCE(json_extract(`payload`, '$.address.name'), ''),
		COALESCE(MAX(json_extract(`payload`, '$.whatsappUpdates')), 0), 0, COUNT(*), MAX(`created_at`), MAX(`created_at`)
	FROM `orders` WHERE json_extract(`payload`, '$.address.phone') IS NOT NULL
	GROUP BY json_extract(`payload`, '$.address.phone');
