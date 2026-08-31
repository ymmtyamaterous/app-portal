CREATE TABLE `access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`ip_hash_sha256` text NOT NULL,
	`accessed_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_logs_link_id_accessed_at_idx` ON `access_logs` (`link_id`,`accessed_at`);--> statement-breakpoint
CREATE INDEX `access_logs_accessed_at_idx` ON `access_logs` (`accessed_at`);--> statement-breakpoint
CREATE TABLE `link_tags` (
	`link_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`link_id`, `tag_id`),
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `link_tags_tag_id_link_id_idx` ON `link_tags` (`tag_id`,`link_id`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`visible` integer DEFAULT true NOT NULL,
	`image_upload_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`image_upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `links_visible_created_at_idx` ON `links` (`visible`,`created_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_unique` ON `tags` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `tags_normalized_name_idx` ON `tags` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`stored_name` text NOT NULL,
	`original_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_kind_created_at_idx` ON `uploads` (`kind`,`created_at`);