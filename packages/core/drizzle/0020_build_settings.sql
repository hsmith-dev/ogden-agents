CREATE TABLE `build_limits` (
	`id` integer PRIMARY KEY NOT NULL,
	`max_concurrent_runs_per_install` integer,
	`max_run_minutes` integer
);
--> statement-breakpoint
CREATE TABLE `workspace_build_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`max_concurrent_runs` integer,
	`test_command` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
