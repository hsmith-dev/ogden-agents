ALTER TABLE `workspaces` ADD `real_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Rows from before story 2.2 have only the canonical path; it is the best real path known for them.
UPDATE `workspaces` SET `real_path` = `path` WHERE `real_path` = '';
