CREATE TABLE `call_labels` (
	`call_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`correct` integer NOT NULL,
	`failure_type` text,
	`notes` text,
	`labeled_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clinic_settings` (
	`clinic_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kill_switch` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `calls` ADD `handoff_seen_at` text;