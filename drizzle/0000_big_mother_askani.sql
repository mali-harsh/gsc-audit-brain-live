CREATE TABLE `audits` (
	`id` text PRIMARY KEY NOT NULL,
	`property` text NOT NULL,
	`file_name` text NOT NULL,
	`status` text NOT NULL,
	`total_rows` integer NOT NULL,
	`evaluated_rows` integer NOT NULL,
	`needs_context_rows` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audits_created_at_idx` ON `audits` (`created_at`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`url` text NOT NULL,
	`reason` text NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_title` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`severity` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`suggestion` text NOT NULL,
	`missing_context_json` text NOT NULL,
	`raw_json` text NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_audit_id_idx` ON `findings` (`audit_id`);--> statement-breakpoint
CREATE INDEX `findings_workflow_id_idx` ON `findings` (`workflow_id`);