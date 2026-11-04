ALTER TABLE "rooms" ADD COLUMN "is_virtual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "is_virtual" boolean DEFAULT false NOT NULL;