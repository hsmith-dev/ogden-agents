CREATE TABLE `agent_settings` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`default_model` text,
	`models` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `model` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `default_models` text DEFAULT '{}' NOT NULL;