CREATE TYPE "public"."lab_flag" AS ENUM('low', 'normal', 'high', 'abnormal', 'none');--> statement-breakpoint
CREATE TABLE "lab_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"taken_on" date NOT NULL,
	"lab_name" text,
	"note" text,
	"file_id" uuid,
	"entered_by_user_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_reports_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "lab_reports_void_reason" CHECK (("lab_reports"."voided_at" is null) = ("lab_reports"."void_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "lab_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"test_name" text NOT NULL,
	"due_on" date NOT NULL,
	"reason" text,
	"requested_by_user_id" text NOT NULL,
	"done_report_id" uuid,
	"done_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"test_name" text NOT NULL,
	"value_text" text NOT NULL,
	"value_num" double precision,
	"unit" text,
	"ref_low" double precision,
	"ref_high" double precision,
	"flag" "lab_flag" DEFAULT 'none' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_report_fk" FOREIGN KEY ("tenant_id","done_report_id") REFERENCES "public"."lab_reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_values" ADD CONSTRAINT "lab_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_values" ADD CONSTRAINT "lab_values_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."lab_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_reports_patient_idx" ON "lab_reports" USING btree ("tenant_id","patient_id","taken_on");--> statement-breakpoint
CREATE INDEX "lab_requests_patient_idx" ON "lab_requests" USING btree ("tenant_id","patient_id","due_on");--> statement-breakpoint
CREATE INDEX "lab_values_report_idx" ON "lab_values" USING btree ("tenant_id","report_id");