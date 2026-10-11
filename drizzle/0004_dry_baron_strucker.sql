CREATE TABLE `payment_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`request_key` text NOT NULL,
	`payload` text NOT NULL,
	`amount` integer NOT NULL,
	`razorpay_order_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_id` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`inventory_released` integer DEFAULT 0 NOT NULL,
	`notifications_sent` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_intents_owner_request` ON `payment_intents` (`owner`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_intents_razorpay_order` ON `payment_intents` (`razorpay_order_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_intents_expiry` ON `payment_intents` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `payment_stock_holds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_intent_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`released_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_payment_stock_holds_intent` ON `payment_stock_holds` (`payment_intent_id`,`released_at`);