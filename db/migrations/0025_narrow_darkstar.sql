CREATE TABLE "clinical_note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"body" text NOT NULL,
	"edited_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_note_versions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinical_note_versions_note_version_key" UNIQUE("tenant_id","note_id","version")
);
--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD COLUMN "corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_note_fk" FOREIGN KEY ("tenant_id","note_id") REFERENCES "public"."clinical_notes"("tenant_id","id") ON DELETE no action ON UPDATE no action;