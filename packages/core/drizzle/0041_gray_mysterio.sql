CREATE TABLE `chat_worktree_retention` (
	`id` integer PRIMARY KEY NOT NULL,
	`keep` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_worktrees_put_away` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`branch` text NOT NULL,
	`snapshot_tree` text,
	`head` text NOT NULL,
	`files` integer NOT NULL,
	`cause` text NOT NULL,
	`put_away_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_worktrees_put_away_session_unique` ON `chat_worktrees_put_away` (`session_id`);--> statement-breakpoint
CREATE INDEX `chat_worktrees_put_away_workspace_idx` ON `chat_worktrees_put_away` (`workspace_id`);