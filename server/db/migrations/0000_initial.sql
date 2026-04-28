-- auto-i18n v2 initial schema
-- Migration: 0000_initial

CREATE TABLE `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` text NOT NULL
);

--> statement-breakpoint
CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `sender_id` text NOT NULL UNIQUE,
  `session_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `source_locale` text NOT NULL,
  `target_locales` text NOT NULL,
  `repo_owner` text,
  `repo_name` text,
  `repo_branch` text,
  `base_commit_sha` text,
  `expires_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

--> statement-breakpoint
CREATE INDEX `sessions_sender_id_idx` ON `sessions` (`sender_id`);
--> statement-breakpoint
CREATE INDEX `sessions_status_idx` ON `sessions` (`status`);
--> statement-breakpoint
CREATE INDEX `sessions_created_at_idx` ON `sessions` (`created_at`);

--> statement-breakpoint
CREATE TABLE `files` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `file_type` text NOT NULL,
  `content_type` text NOT NULL,
  `format` text NOT NULL,
  `locale` text NOT NULL,
  `file_path` text NOT NULL,
  `content` text NOT NULL,
  `created_at` text NOT NULL
);

--> statement-breakpoint
CREATE INDEX `files_session_file_type_idx` ON `files` (`session_id`, `file_type`);
--> statement-breakpoint
CREATE INDEX `files_session_locale_idx` ON `files` (`session_id`, `locale`);

--> statement-breakpoint
CREATE TABLE `batches` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `provider` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `external_batch_id` text,
  `manifest` text,
  `total_requests` integer NOT NULL DEFAULT 0,
  `completed` integer NOT NULL DEFAULT 0,
  `failed` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

--> statement-breakpoint
CREATE INDEX `batches_session_idx` ON `batches` (`session_id`);
--> statement-breakpoint
CREATE INDEX `batches_status_idx` ON `batches` (`status`);

--> statement-breakpoint
CREATE TABLE `batch_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL REFERENCES `batches`(`id`) ON DELETE CASCADE,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `custom_id` text NOT NULL,
  `request_body` text NOT NULL,
  `response_body` text,
  `status` text NOT NULL DEFAULT 'pending'
);

--> statement-breakpoint
CREATE INDEX `batch_requests_batch_idx` ON `batch_requests` (`batch_id`);

--> statement-breakpoint
CREATE TABLE `git_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL UNIQUE REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `forge` text NOT NULL,
  `issue_number` integer,
  `pr_number` integer,
  `pr_url` text,
  `branch` text,
  `status` text NOT NULL DEFAULT 'pending',
  `error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

--> statement-breakpoint
CREATE INDEX `git_jobs_session_idx` ON `git_jobs` (`session_id`);

--> statement-breakpoint
CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `job_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `payload` text,
  `error` text,
  `run_after` text,
  `attempts` integer NOT NULL DEFAULT 0,
  `max_attempts` integer NOT NULL DEFAULT 3,
  `heartbeat_at` text,
  `created_at` text NOT NULL
);

--> statement-breakpoint
CREATE INDEX `jobs_status_run_after_idx` ON `jobs` (`status`, `run_after`);
--> statement-breakpoint
CREATE INDEX `jobs_session_idx` ON `jobs` (`session_id`);
--> statement-breakpoint
CREATE INDEX `jobs_job_type_idx` ON `jobs` (`job_type`);

--> statement-breakpoint
CREATE TABLE `pipeline_events` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `step` text NOT NULL,
  `status` text NOT NULL,
  `duration_ms` integer,
  `request` text,
  `response` text,
  `error` text,
  `created_at` text NOT NULL
);

--> statement-breakpoint
CREATE INDEX `pipeline_events_session_idx` ON `pipeline_events` (`session_id`);
--> statement-breakpoint
CREATE INDEX `pipeline_events_session_step_idx` ON `pipeline_events` (`session_id`, `step`);

--> statement-breakpoint
CREATE TABLE `api_request_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `request_body` text NOT NULL,
  `response_body` text,
  `status_code` integer,
  `duration_ms` integer,
  `is_mock` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL
);

--> statement-breakpoint
CREATE INDEX `api_logs_session_idx` ON `api_request_logs` (`session_id`);
--> statement-breakpoint
CREATE INDEX `api_logs_provider_idx` ON `api_request_logs` (`provider`);
