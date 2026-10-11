ALTER TABLE `products` ADD `needs_price_review` integer DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `products` (`id`, `name`, `local`, `unit`, `price`, `mrp`, `category`, `image`, `needs_price_review`, `stock`, `active`, `sort`, `updated_at`) VALUES
	('cauliflower', 'Cauliflower', 'Phool gobi · फुलगोभी', '1 pc', 1, 1, 'Vegetables', 'cauliflower', 1, 0, 0, 9, '2026-10-08T00:00:00.000Z'),
	('capsicum', 'Capsicum', 'Shimla mirch · ढोबळी मिरची', '500 g', 1, 1, 'Vegetables', 'capsicum', 1, 0, 0, 10, '2026-10-08T00:00:00.000Z'),
	('bitter-gourd', 'Bitter gourd', 'Karela · कारले', '500 g', 1, 1, 'Vegetables', 'bitter-gourd', 1, 0, 0, 11, '2026-10-08T00:00:00.000Z'),
	('radish', 'Radish', 'Mooli · मुळा', '500 g', 1, 1, 'Vegetables', 'radish', 1, 0, 0, 12, '2026-10-08T00:00:00.000Z'),
	('garlic', 'Garlic', 'Lahsun · लसूण', '250 g', 1, 1, 'Vegetables', 'garlic', 1, 0, 0, 13, '2026-10-08T00:00:00.000Z'),
	('coriander', 'Coriander', 'Dhaniya · कोथिंबीर', '1 bunch', 1, 1, 'Greens', 'coriander', 1, 0, 0, 14, '2026-10-08T00:00:00.000Z'),
	('lemon', 'Lemon', 'Nimbu · लिंबू', '4 pcs', 1, 1, 'Fruits', 'lemon', 1, 0, 0, 15, '2026-10-08T00:00:00.000Z'),
	('watermelon', 'Watermelon', 'Tarbooz · कलिंगड', '1 pc', 1, 1, 'Fruits', 'watermelon', 1, 0, 0, 16, '2026-10-08T00:00:00.000Z'),
	('mango', 'Mango', 'Aam · आंबा', '1 kg', 1, 1, 'Fruits', 'mango', 1, 0, 0, 17, '2026-10-08T00:00:00.000Z'),
	('grapes', 'Grapes', 'Angoor · द्राक्षे', '500 g', 1, 1, 'Fruits', 'grapes', 1, 0, 0, 18, '2026-10-08T00:00:00.000Z');