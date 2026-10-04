CREATE TABLE `bmad_modules_seen` (
	`workspace_id` text NOT NULL,
	`code` text NOT NULL,
	`installed_at` text,
	`seen_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bmad_modules_seen_unique` ON `bmad_modules_seen` (`workspace_id`,`code`);