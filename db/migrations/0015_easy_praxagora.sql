ALTER TABLE "tenants" ADD COLUMN "whatsapp_phone_number_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "whatsapp_business_account_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "whatsapp_display_phone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "whatsapp_token_enc" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "whatsapp_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_whatsapp_phone_number_id_unique" UNIQUE("whatsapp_phone_number_id");