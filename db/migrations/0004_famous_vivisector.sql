CREATE TABLE "schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"branch_id" uuid,
	"start_time" time,
	"end_time" time,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_exceptions_kind" CHECK (("schedule_exceptions"."kind" = 'off' and "schedule_exceptions"."branch_id" is null and "schedule_exceptions"."start_time" is null and "schedule_exceptions"."end_time" is null) or ("schedule_exceptions"."kind" = 'hours' and "schedule_exceptions"."branch_id" is not null and "schedule_exceptions"."start_time" < "schedule_exceptions"."end_time"))
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "doctors_edit_own_hours" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."tenant_members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_exceptions_member_day_idx" ON "schedule_exceptions" USING btree ("tenant_id","member_id","day");