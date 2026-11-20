CREATE TYPE "public"."dental_plan_status" AS ENUM('planned', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lab_case_status" AS ENUM('sent', 'received', 'fitted', 'remake', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lab_work" AS ENUM('crown', 'bridge', 'veneer', 'denture', 'aligner', 'night_guard', 'implant_part', 'other');--> statement-breakpoint
CREATE TYPE "public"."tooth_condition" AS ENUM('healthy', 'caries', 'filled', 'crown', 'root_canal', 'missing', 'implant', 'bridge', 'extraction_needed', 'watch');--> statement-breakpoint
CREATE TABLE "dental_chart_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tooth" smallint NOT NULL,
	"surfaces" text DEFAULT '' NOT NULL,
	"condition" "tooth_condition" NOT NULL,
	"note" text,
	"appointment_id" uuid,
	"recorded_by_user_id" text NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dental_chart_entries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dental_chart_entries_tooth" CHECK ("dental_chart_entries"."tooth" between 11 and 48 and "dental_chart_entries"."tooth" % 10 between 1 and 8),
	CONSTRAINT "dental_chart_entries_surfaces" CHECK ("dental_chart_entries"."surfaces" ~ '^[MODBL]{0,5}$')
);
--> statement-breakpoint
CREATE TABLE "dental_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tooth" smallint,
	"surfaces" text DEFAULT '' NOT NULL,
	"service_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"price_halalas" integer NOT NULL,
	"status" "dental_plan_status" DEFAULT 'planned' NOT NULL,
	"note" text,
	"appointment_id" uuid,
	"done_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dental_plan_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dental_plan_items_tooth" CHECK ("dental_plan_items"."tooth" is null or ("dental_plan_items"."tooth" between 11 and 48 and "dental_plan_items"."tooth" % 10 between 1 and 8)),
	CONSTRAINT "dental_plan_items_price" CHECK ("dental_plan_items"."price_halalas" >= 0),
	CONSTRAINT "dental_plan_items_done" CHECK (("dental_plan_items"."status" = 'done') = ("dental_plan_items"."done_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "lab_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"practitioner_id" uuid NOT NULL,
	"lab_name" text NOT NULL,
	"work" "lab_work" NOT NULL,
	"teeth" text DEFAULT '' NOT NULL,
	"shade" text,
	"sent_on" date NOT NULL,
	"due_on" date NOT NULL,
	"status" "lab_case_status" DEFAULT 'sent' NOT NULL,
	"notes" text,
	"received_at" timestamp with time zone,
	"fitted_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_cases_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "lab_cases_dates" CHECK ("lab_cases"."due_on" >= "lab_cases"."sent_on")
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "dental_chart_entries" ADD CONSTRAINT "dental_chart_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_chart_entries" ADD CONSTRAINT "dental_chart_entries_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_chart_entries" ADD CONSTRAINT "dental_chart_entries_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_plan_items" ADD CONSTRAINT "dental_plan_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_plan_items" ADD CONSTRAINT "dental_plan_items_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_plan_items" ADD CONSTRAINT "dental_plan_items_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_plan_items" ADD CONSTRAINT "dental_plan_items_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_practitioner_fk" FOREIGN KEY ("tenant_id","practitioner_id") REFERENCES "public"."tenant_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dental_chart_entries_patient_idx" ON "dental_chart_entries" USING btree ("tenant_id","patient_id","tooth","created_at");--> statement-breakpoint
CREATE INDEX "dental_plan_items_patient_idx" ON "dental_plan_items" USING btree ("tenant_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "lab_cases_due_idx" ON "lab_cases" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "lab_cases_patient_idx" ON "lab_cases" USING btree ("tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE no action ON UPDATE no action;