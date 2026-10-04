ALTER TABLE `runs` ADD `agent` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `blocked_code` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `queue_position` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `decision` text;--> statement-breakpoint
UPDATE `runs` SET `decision` = 'rejected' WHERE `outcome` = 'stopped' AND `decision` IS NULL;--> statement-breakpoint
UPDATE `runs` SET `blocked_code` = 'interrupted' WHERE `outcome` = 'blocked' AND `reason` = 'interrupted' AND `blocked_code` IS NULL;--> statement-breakpoint
UPDATE `runs` SET `blocked_code` = 'merge_conflict' WHERE `outcome` = 'blocked' AND `reason` = 'The build''s changes conflict with your project, so nothing was merged. The run needs a rebase.' AND `blocked_code` IS NULL;
