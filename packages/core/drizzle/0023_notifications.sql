CREATE TABLE `notification_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`browser_notifications` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`events` text NOT NULL,
	`created_at` text NOT NULL
);
