CREATE TABLE `dev_tools_custom` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`executable` text NOT NULL,
	`install_command` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dev_tools_unattended_allow` (
	`workspace_id` text NOT NULL,
	`tool_id` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dev_tools_unattended_allow_unique` ON `dev_tools_unattended_allow` (`workspace_id`,`tool_id`);