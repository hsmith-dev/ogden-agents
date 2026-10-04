CREATE TABLE `install_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`developer_mode` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `permission_mode` text DEFAULT 'ask' NOT NULL;