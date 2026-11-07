CREATE TABLE `ai_rules_document` (
	`household_id` text PRIMARY KEY NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`scope` text NOT NULL,
	`match_value` text NOT NULL,
	`set_custom_name` text,
	`set_category_id` text,
	`set_spend_type` text,
	`set_income_kind` text,
	`set_income_subtype` text,
	`set_fixed_income_id` text,
	`set_movement` text,
	`created_from` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`disabled_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rules_scope_ck" CHECK("rules"."scope" IN ('estabelecimento', 'destinatario', 'remetente', 'conta_destino')),
	CONSTRAINT "rules_created_from_ck" CHECK("rules"."created_from" IN ('aplicar_todas', 'lembrar', 'confirmacao', 'manual')),
	CONSTRAINT "rules_spend_type_ck" CHECK("rules"."set_spend_type" IS NULL OR "rules"."set_spend_type" IN ('fixos', 'conforto', 'educacao', 'extras', 'prazeres', 'metas', 'investimentos')),
	CONSTRAINT "rules_movement_ck" CHECK("rules"."set_movement" IS NULL OR "rules"."set_movement" = 'pagamento_fatura')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rules_active_match` ON `rules` (`household_id`,`scope`,`match_value`) WHERE "rules"."disabled_at" IS NULL;