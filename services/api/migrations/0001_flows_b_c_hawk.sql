CREATE TABLE `contact_preferences` (
	`tenant_id` text NOT NULL,
	`phone` text NOT NULL,
	`do_not_call` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`tenant_id`, `phone`)
);
--> statement-breakpoint
CREATE TABLE `hawk_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`report_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hawk_reports_tenant_created` ON `hawk_reports` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reminder_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`call_id` text NOT NULL,
	`outcome` text NOT NULL,
	`attempted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminder_attempts_appt` ON `reminder_attempts` (`tenant_id`,`appointment_id`);--> statement-breakpoint
CREATE TABLE `staff_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`call_id` text NOT NULL,
	`patient_id` text,
	`caller_name` text,
	`category` text NOT NULL,
	`summary` text NOT NULL,
	`urgency` text NOT NULL,
	`callback_number` text NOT NULL,
	`callback_by` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`done_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `staff_tasks_tenant_status` ON `staff_tasks` (`tenant_id`,`status`,`callback_by`);