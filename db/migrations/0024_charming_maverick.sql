ALTER TABLE "appointments" ADD COLUMN "self_checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "arrival_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "self_check_in_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "self_check_in_before_minutes" smallint DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "self_check_in_after_minutes" smallint DEFAULT 30 NOT NULL;