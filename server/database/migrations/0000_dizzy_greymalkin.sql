CREATE TABLE "batch_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"custom_id" varchar(255) NOT NULL,
	"request_index" integer NOT NULL,
	"file_id" uuid,
	"relative_path" text NOT NULL,
	"target_locale" varchar(10) NOT NULL,
	"request_body" jsonb NOT NULL,
	"response_body" jsonb,
	"response_status" integer,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_requests_batch_custom_unique" UNIQUE("batch_id","custom_id")
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" varchar(255) NOT NULL,
	"session_id" uuid NOT NULL,
	"source_locale" varchar(10) NOT NULL,
	"target_locales" text[],
	"content_types" text[],
	"model" varchar(100) NOT NULL,
	"openai_batch_id" varchar(255),
	"openai_status" varchar(50),
	"total_requests" integer DEFAULT 0 NOT NULL,
	"completed_requests" integer DEFAULT 0,
	"failed_requests" integer DEFAULT 0,
	"status" varchar(50) DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"manifest" jsonb NOT NULL,
	CONSTRAINT "batches_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"job_id" uuid,
	"file_type" varchar(50) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"format" varchar(20) NOT NULL,
	"locale" varchar(10) NOT NULL,
	"relative_path" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64),
	"file_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "files_session_type_locale_path_unique" UNIQUE("session_id","file_type","locale","relative_path")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" varchar(255) NOT NULL,
	"session_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"repository_owner" varchar(255),
	"repository_name" varchar(255),
	"base_branch" varchar(255),
	"base_commit_sha" varchar(40),
	"commit_sha" varchar(40),
	"commit_message" text,
	"commit_author" varchar(255),
	"commit_timestamp" timestamp with time zone,
	"source_locale" varchar(10) NOT NULL,
	"target_locales" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "sessions_sender_id_unique" UNIQUE("sender_id")
);
--> statement-breakpoint
CREATE TABLE "translation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"job_id" varchar(255) NOT NULL,
	"job_type" varchar(50),
	"source_locale" varchar(10) NOT NULL,
	"target_locales" text[],
	"github_issue_number" integer,
	"github_issue_url" text,
	"github_pr_number" integer,
	"github_pr_url" text,
	"github_branch" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_jobs_session_job_unique" UNIQUE("session_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "translation_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"uploads_count" integer DEFAULT 0,
	"translations_count" integer DEFAULT 0,
	"content_files" integer DEFAULT 0,
	"global_files" integer DEFAULT 0,
	"page_files" integer DEFAULT 0,
	"source_locale" varchar(10),
	"target_locales_count" integer DEFAULT 0,
	"completed_locales" text[],
	"batches_count" integer DEFAULT 0,
	"active_batches" integer DEFAULT 0,
	"completed_batches" integer DEFAULT 0,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
ALTER TABLE "batch_requests" ADD CONSTRAINT "batch_requests_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_requests" ADD CONSTRAINT "batch_requests_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_job_id_translation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."translation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_stats" ADD CONSTRAINT "translation_stats_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batch_requests_batch" ON "batch_requests" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_batch_requests_status" ON "batch_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_batch_requests_locale" ON "batch_requests" USING btree ("target_locale");--> statement-breakpoint
CREATE INDEX "idx_batch_requests_custom_id" ON "batch_requests" USING btree ("custom_id");--> statement-breakpoint
CREATE INDEX "idx_batches_batch_id" ON "batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_batches_session" ON "batches" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_batches_status" ON "batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_batches_created_at" ON "batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_files_session" ON "files" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_files_type" ON "files" USING btree ("file_type");--> statement-breakpoint
CREATE INDEX "idx_files_content_type" ON "files" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "idx_files_locale" ON "files" USING btree ("locale");--> statement-breakpoint
CREATE INDEX "idx_files_path" ON "files" USING btree ("relative_path");--> statement-breakpoint
CREATE INDEX "idx_sessions_sender_id" ON "sessions" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sessions_type" ON "sessions" USING btree ("session_type");--> statement-breakpoint
CREATE INDEX "idx_sessions_created_at" ON "sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_translation_jobs_session" ON "translation_jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_translation_jobs_job_id" ON "translation_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_translation_stats_session" ON "translation_stats" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_translation_stats_calculated" ON "translation_stats" USING btree ("calculated_at");