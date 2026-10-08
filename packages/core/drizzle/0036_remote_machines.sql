CREATE TABLE `remote_machines` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`username` text NOT NULL,
	`label` text NOT NULL,
	`host_key_fingerprint` text,
	`public_key` text,
	`host_key_confirmed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
