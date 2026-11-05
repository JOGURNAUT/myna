CREATE TABLE `waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`service_id` text NOT NULL,
	`date` text NOT NULL,
	`from_time` text,
	`to_time` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`appointment_id` text,
	`hold_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `waitlist_tenant_status_date` ON `waitlist` (`tenant_id`,`status`,`date`);