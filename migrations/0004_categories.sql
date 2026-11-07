CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`parent_id` text,
	`default_spend_type` text,
	`ai_hint` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `categories_household_archived_idx` ON `categories` (`household_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `categories_household_parent_idx` ON `categories` (`household_id`,`parent_id`);