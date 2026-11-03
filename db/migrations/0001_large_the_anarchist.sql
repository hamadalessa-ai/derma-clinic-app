ALTER TABLE "conversations" ADD COLUMN "ai_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_pending_action" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "ai_receptionist_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "ai_daily_limit" smallint DEFAULT 200 NOT NULL;