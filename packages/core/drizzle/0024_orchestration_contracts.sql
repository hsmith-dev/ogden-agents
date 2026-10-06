CREATE TABLE `orchestration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`goal` text NOT NULL,
	`state` text NOT NULL,
	`mode` text NOT NULL,
	`limits` text NOT NULL,
	`stop_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orchestration_runs_workspace` ON `orchestration_runs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `orchestration_steps` (
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`position` integer NOT NULL,
	`worker` text NOT NULL,
	`chat` text NOT NULL,
	`instruction` text NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`state` text NOT NULL,
	`approved_by` text,
	`session_id` text,
	PRIMARY KEY(`run_id`, `step_id`),
	FOREIGN KEY (`run_id`) REFERENCES `orchestration_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `orchestration_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `orchestration_mode` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `orchestration_roster` text;