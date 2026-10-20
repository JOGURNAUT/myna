PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reminder_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`call_id` text NOT NULL,
	`outcome` text NOT NULL,
	`attempted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_reminder_attempts`("id", "tenant_id", "appointment_id", "call_id", "outcome", "attempted_at") SELECT "id", "tenant_id", "appointment_id", "call_id", "outcome", "attempted_at" FROM `reminder_attempts`;--> statement-breakpoint
DROP TABLE `reminder_attempts`;--> statement-breakpoint
ALTER TABLE `__new_reminder_attempts` RENAME TO `reminder_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reminder_attempts_appt` ON `reminder_attempts` (`tenant_id`,`appointment_id`);--> statement-breakpoint
CREATE TABLE `__new_sms_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`language` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sms_outbox`("id", "tenant_id", "appointment_id", "language", "status", "created_at") SELECT "id", "tenant_id", "appointment_id", "language", "status", "created_at" FROM `sms_outbox`;--> statement-breakpoint
DROP TABLE `sms_outbox`;--> statement-breakpoint
ALTER TABLE `__new_sms_outbox` RENAME TO `sms_outbox`;--> statement-breakpoint
CREATE TABLE `__new_staff_tasks` (
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
	`done_at` text
);
--> statement-breakpoint
INSERT INTO `__new_staff_tasks`("id", "tenant_id", "call_id", "patient_id", "caller_name", "category", "summary", "urgency", "callback_number", "callback_by", "status", "created_at", "done_at") SELECT "id", "tenant_id", "call_id", "patient_id", "caller_name", "category", "summary", "urgency", "callback_number", "callback_by", "status", "created_at", "done_at" FROM `staff_tasks`;--> statement-breakpoint
DROP TABLE `staff_tasks`;--> statement-breakpoint
ALTER TABLE `__new_staff_tasks` RENAME TO `staff_tasks`;--> statement-breakpoint
CREATE INDEX `staff_tasks_tenant_status` ON `staff_tasks` (`tenant_id`,`status`,`callback_by`);--> statement-breakpoint
CREATE TABLE `__new_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`call_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_verifications`("id", "tenant_id", "patient_id", "call_id", "expires_at", "created_at") SELECT "id", "tenant_id", "patient_id", "call_id", "expires_at", "created_at" FROM `verifications`;--> statement-breakpoint
DROP TABLE `verifications`;--> statement-breakpoint
ALTER TABLE `__new_verifications` RENAME TO `verifications`;