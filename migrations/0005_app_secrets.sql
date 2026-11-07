CREATE TABLE `app_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`name` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	CONSTRAINT "feature_flags_enabled_ck" CHECK("feature_flags"."enabled" IN (0, 1))
);
