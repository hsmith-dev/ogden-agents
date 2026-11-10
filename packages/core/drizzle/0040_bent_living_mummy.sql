CREATE TABLE `tracker_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`scope` text,
	`created_at` text NOT NULL
);
