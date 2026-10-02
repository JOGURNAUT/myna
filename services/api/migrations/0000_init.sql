CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`service_id` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`status` text NOT NULL,
	`source` text DEFAULT 'agent' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_tenant_resource_start` ON `appointments` (`tenant_id`,`resource_id`,`start`);--> statement-breakpoint
CREATE INDEX `appointments_tenant_patient` ON `appointments` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_no_double_start` ON `appointments` (`tenant_id`,`resource_id`,`start`) WHERE status <> 'cancelled';--> statement-breakpoint
CREATE TABLE `call_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`call_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `call_events_call` ON `call_events` (`tenant_id`,`call_id`,`id`);--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`direction` text NOT NULL,
	`source` text NOT NULL,
	`caller_phone_masked` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ended_at` text,
	`outcome` text,
	`handoff_reason` text
);
--> statement-breakpoint
CREATE INDEX `calls_tenant_started` ON `calls` (`tenant_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `clinics` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`tenant_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`phone` text NOT NULL,
	`dob` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `patients_tenant_phone` ON `patients` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE INDEX `patients_tenant_dob` ON `patients` (`tenant_id`,`dob`);--> statement-breakpoint
CREATE TABLE `sms_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`language` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`call_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
