CREATE TABLE `jira_links` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`site_url` text NOT NULL,
	`email` text NOT NULL,
	`base_url` text NOT NULL,
	`project_key` text NOT NULL,
	`last_synced_at` text,
	`last_sync_error` text,
	`created_at` text NOT NULL
);
