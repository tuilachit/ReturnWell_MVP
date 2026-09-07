CREATE TABLE `practice_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`address` text,
	`suburb` text,
	`postcode` text,
	`state` text DEFAULT 'NSW' NOT NULL,
	`latitude` real,
	`longitude` real,
	`source_url` text,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_practice_locations_practice` ON `practice_locations` (`practice_id`);--> statement-breakpoint
CREATE INDEX `idx_practice_locations_postcode` ON `practice_locations` (`postcode`);--> statement-breakpoint
CREATE INDEX `idx_practice_locations_coordinates` ON `practice_locations` (`latitude`,`longitude`);--> statement-breakpoint
CREATE TABLE `practices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`business_phone` text,
	`business_email` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_practices_website_name` ON `practices` (`website`,`name`);--> statement-breakpoint
CREATE TABLE `practitioner_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`attribute_type` text NOT NULL,
	`observed_value` text NOT NULL,
	`provider_confirmed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_practitioner_attributes_type_value` ON `practitioner_attributes` (`attribute_type`,`observed_value`);--> statement-breakpoint
CREATE TABLE `practitioner_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`field_name` text NOT NULL,
	`observed_value` text,
	`source_url` text NOT NULL,
	`source_type` text NOT NULL,
	`confidence` text NOT NULL,
	`observed_at` text,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_practitioner_evidence_practitioner_field` ON `practitioner_evidence` (`practitioner_id`,`field_name`);--> statement-breakpoint
CREATE TABLE `practitioner_practices` (
	`practitioner_id` text NOT NULL,
	`practice_id` text NOT NULL,
	`role_title` text,
	`profile_url` text,
	`profession_evidence` text,
	PRIMARY KEY(`practitioner_id`, `practice_id`),
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_practitioner_practices_practice` ON `practitioner_practices` (`practice_id`);--> statement-breakpoint
CREATE TABLE `practitioners` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`profession` text NOT NULL,
	`lifecycle_status` text DEFAULT 'candidate' NOT NULL,
	`review_status` text NOT NULL,
	`identity_review` text NOT NULL,
	`ahpra_registration_number` text,
	`ahpra_verification_status` text DEFAULT 'not_checked' NOT NULL,
	`ahpra_verified_at` text,
	`provider_confirmation_status` text DEFAULT 'not_contacted' NOT NULL,
	`provider_confirmed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_practitioners_ahpra_number` ON `practitioners` (`ahpra_registration_number`);--> statement-breakpoint
CREATE INDEX `idx_practitioners_profession_lifecycle` ON `practitioners` (`profession`,`lifecycle_status`);--> statement-breakpoint
CREATE INDEX `idx_practitioners_verification_queue` ON `practitioners` (`ahpra_verification_status`,`review_status`);--> statement-breakpoint
CREATE TABLE `verification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`verification_type` text NOT NULL,
	`outcome` text NOT NULL,
	`registration_number` text,
	`notes` text,
	`reviewed_by` text,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_verification_events_practitioner_date` ON `verification_events` (`practitioner_id`,`reviewed_at`);