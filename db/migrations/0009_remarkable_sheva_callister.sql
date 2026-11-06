CREATE TYPE "public"."clinic_status" AS ENUM('active', 'read_only', 'suspended', 'closed');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" "clinic_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status_changed_at" timestamp with time zone;