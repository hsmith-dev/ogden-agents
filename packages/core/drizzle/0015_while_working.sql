CREATE TABLE `chat_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`while_working` text DEFAULT 'wait' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `while_working` text;