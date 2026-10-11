ALTER TABLE `customers` ADD `account_type` text DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `business_name` text DEFAULT '' NOT NULL;