ALTER TABLE "clinical_notes" ADD COLUMN "ai_drafted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "ai_scribe_enabled" boolean DEFAULT false NOT NULL;