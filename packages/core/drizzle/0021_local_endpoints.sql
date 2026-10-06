CREATE TABLE `local_endpoint_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_endpoint_id` text
);
--> statement-breakpoint
CREATE TABLE `local_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`preset` text,
	`base_url` text NOT NULL,
	`auth` text DEFAULT 'none' NOT NULL,
	`model` text,
	`remote_confirmed_for` text,
	`created_at` text NOT NULL
);
