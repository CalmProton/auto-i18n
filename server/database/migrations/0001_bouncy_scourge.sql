CREATE TABLE "api_request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"provider" varchar(50) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"method" varchar(10) DEFAULT 'POST' NOT NULL,
	"request_headers" jsonb,
	"request_body" jsonb,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" jsonb,
	"error_message" text,
	"error_stack" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_path" text,
	"source_locale" varchar(10),
	"target_locale" varchar(10),
	"is_mock" varchar(5) DEFAULT 'false'
);
--> statement-breakpoint
CREATE TABLE "pipeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"step" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"message" text,
	"duration_ms" integer,
	"request_data" jsonb,
	"response_data" jsonb,
	"error_data" jsonb,
	"batch_id" varchar(255),
	"job_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_events" ADD CONSTRAINT "pipeline_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_logs_session" ON "api_request_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_api_logs_provider" ON "api_request_logs" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_api_logs_created" ON "api_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_api_logs_status" ON "api_request_logs" USING btree ("response_status");--> statement-breakpoint
CREATE INDEX "idx_pipeline_events_session" ON "pipeline_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_pipeline_events_step" ON "pipeline_events" USING btree ("step");--> statement-breakpoint
CREATE INDEX "idx_pipeline_events_status" ON "pipeline_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pipeline_events_created" ON "pipeline_events" USING btree ("created_at");