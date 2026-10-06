ALTER TABLE `orchestration_steps` ADD `rule_id` text;--> statement-breakpoint
ALTER TABLE `orchestration_steps` ADD `rule_text` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `orchestration_routing` text;