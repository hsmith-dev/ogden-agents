CREATE TABLE `trial_chats` (
	`trial_id` text NOT NULL,
	`position` integer NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`trial_id`, `position`),
	FOREIGN KEY (`trial_id`) REFERENCES `trials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trial_chats_session_idx` ON `trial_chats` (`session_id`);--> statement-breakpoint
CREATE TABLE `trials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`text` text NOT NULL,
	`kept_session_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trials_workspace_idx` ON `trials` (`workspace_id`);