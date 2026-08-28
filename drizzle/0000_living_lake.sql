CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`work_date` text NOT NULL,
	`check_in_at` text NOT NULL,
	`check_in_device_at` text DEFAULT '' NOT NULL,
	`check_in_lat` real NOT NULL,
	`check_in_lng` real NOT NULL,
	`check_in_accuracy` real DEFAULT 0 NOT NULL,
	`check_in_photo_key` text NOT NULL,
	`check_out_at` text,
	`check_out_device_at` text,
	`check_out_lat` real,
	`check_out_lng` real,
	`check_out_accuracy` real,
	`check_out_photo_key` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attendance_user_date` ON `attendance` (`user_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `idx_attendance_work_date` ON `attendance` (`work_date`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_expiry` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username_ci` ON `users` (lower("username"));--> statement-breakpoint
CREATE INDEX `idx_users_active_role` ON `users` (`active`,`role`);