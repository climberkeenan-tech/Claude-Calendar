ALTER TABLE "user_settings" ADD COLUMN "transition_buffer_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "day_start" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "day_end" text DEFAULT '22:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "max_plan_minutes_per_day" integer DEFAULT 240 NOT NULL;