CREATE TABLE `content_pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`final_url` text NOT NULL,
	`title` text NOT NULL,
	`funnel` text NOT NULL,
	`status_code` integer NOT NULL,
	`word_count` integer NOT NULL,
	`schema_types_json` text NOT NULL,
	`freshness_date` text,
	`audited_at` text NOT NULL,
	`issues_json` text NOT NULL,
	`issue_count` integer NOT NULL,
	`group_counts_json` text NOT NULL,
	`priority` text NOT NULL,
	`consolidated_fixes_json` text NOT NULL,
	`fix_status` text NOT NULL,
	`owner` text NOT NULL,
	`notes_json` text NOT NULL,
	`history_json` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_pieces_url_unique` ON `content_pieces` (`url`);--> statement-breakpoint
CREATE INDEX `content_pieces_audited_at_idx` ON `content_pieces` (`audited_at`);--> statement-breakpoint
CREATE INDEX `content_pieces_priority_idx` ON `content_pieces` (`priority`);