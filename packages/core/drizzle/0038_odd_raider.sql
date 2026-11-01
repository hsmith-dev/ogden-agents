CREATE TABLE `custom_agents` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`command_line` text NOT NULL,
	`key_env_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
