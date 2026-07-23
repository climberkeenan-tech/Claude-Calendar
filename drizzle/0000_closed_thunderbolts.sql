CREATE TYPE "public"."event_kind" AS ENUM('event', 'task', 'habit');--> statement-breakpoint
CREATE TYPE "public"."event_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('manual', 'quick_add', 'syllabus', 'ai_suggestion', 'integration');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."focus_kind" AS ENUM('study', 'work', 'reading', 'other');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'parsing', 'review', 'approved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('new', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'cancelled', 'acknowledged', 'deferred');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"confidence" real,
	"action" jsonb,
	"status" "insight_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"blob_url" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"icon" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"professor" text,
	"location" text,
	"color" text,
	"office_hours" jsonb,
	"term" text,
	"source_import_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"minutes_studied" integer DEFAULT 0 NOT NULL,
	"minutes_by_category" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"free_minutes" integer DEFAULT 0 NOT NULL,
	"avg_work_session_minutes" real,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"tasks_completed_late" integer DEFAULT 0 NOT NULL,
	"tasks_overdue" integer DEFAULT 0 NOT NULL,
	"focus_session_count" integer DEFAULT 0 NOT NULL,
	"productivity_score" real,
	CONSTRAINT "daily_stats_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"notes" text,
	"kind" "event_kind" DEFAULT 'event' NOT NULL,
	"category_id" text,
	"course_id" text,
	"location" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"rrule" text,
	"tz" text DEFAULT 'America/New_York' NOT NULL,
	"priority" "event_priority" DEFAULT 'normal' NOT NULL,
	"estimated_minutes" integer,
	"actual_minutes" integer,
	"tags" text[],
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"completed_at" timestamp with time zone,
	"habit_target_per_week" integer,
	"source" "event_source" DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text,
	"course_id" text,
	"kind" "focus_kind" DEFAULT 'study' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "notification_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"reminder_id" text,
	"event_id" text NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"qstash_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"is_escalation" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"acked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"event_id" text NOT NULL,
	"occurrence_date" date NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"overrides" jsonb,
	CONSTRAINT "occurrences_event_id_occurrence_date_pk" PRIMARY KEY("event_id","occurrence_date")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"offset_minutes" integer,
	"absolute_at" timestamp with time zone,
	"channels" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "syllabus_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"blob_url" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"course_id" text,
	"extraction" jsonb,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_patterns" (
	"user_id" text PRIMARY KEY NOT NULL,
	"patterns" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"week_start_day" integer DEFAULT 1 NOT NULL,
	"default_reminders" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"phone_number" text,
	"channel_prefs" jsonb DEFAULT '{"inApp":true,"push":true,"email":true,"sms":false}'::jsonb NOT NULL,
	"escalation_enabled" boolean DEFAULT true NOT NULL,
	"focus_target_minutes_per_day" integer,
	"show_productivity_score" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_imports" ADD CONSTRAINT "syllabus_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_imports" ADD CONSTRAINT "syllabus_imports_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_patterns" ADD CONSTRAINT "user_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_created_idx" ON "activity_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "insights_user_status_idx" ON "ai_insights" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "attachments_event_idx" ON "attachments" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_idx" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "checklist_event_idx" ON "checklist_items" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_user_starts_idx" ON "events" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_user_due_idx" ON "events" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "events_user_kind_idx" ON "events" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "focus_user_started_idx" ON "focus_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "jobs_status_send_idx" ON "notification_jobs" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "jobs_event_idx" ON "notification_jobs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "reminders_event_idx" ON "reminders" USING btree ("event_id");