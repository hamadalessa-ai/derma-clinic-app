ALTER TYPE "public"."member_role" ADD VALUE 'assistant';--> statement-breakpoint
CREATE TABLE "care_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assistant_member_id" uuid NOT NULL,
	"practitioner_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_team_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "care_team_pair_key" UNIQUE("tenant_id","assistant_member_id","practitioner_member_id")
);
--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD COLUMN "entered_by_user_id" text;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD COLUMN "entered_by_name" text;--> statement-breakpoint
ALTER TABLE "care_team" ADD CONSTRAINT "care_team_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team" ADD CONSTRAINT "care_team_assistant_fk" FOREIGN KEY ("tenant_id","assistant_member_id") REFERENCES "public"."tenant_members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team" ADD CONSTRAINT "care_team_practitioner_fk" FOREIGN KEY ("tenant_id","practitioner_member_id") REFERENCES "public"."tenant_members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_team_practitioner_idx" ON "care_team" USING btree ("tenant_id","practitioner_member_id");