CREATE TABLE `chat_worktree_ports` (
	`session_id` text PRIMARY KEY NOT NULL,
	`port` integer NOT NULL,
	`held` integer NOT NULL,
	`assigned_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_worktree_ports_held_port_unique` ON `chat_worktree_ports` (`port`) WHERE "chat_worktree_ports"."held" = 1;