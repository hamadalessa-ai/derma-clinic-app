CREATE TABLE "membership_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_membership_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"invoice_number" text,
	"recorded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_payments_positive" CHECK ("membership_payments"."amount_halalas" > 0)
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"price_halalas" integer NOT NULL,
	"period_months" smallint NOT NULL,
	"included_service_id" uuid,
	"included_visits" smallint DEFAULT 0 NOT NULL,
	"discount_percent" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "membership_plans_values" CHECK ("membership_plans"."price_halalas" >= 0 and "membership_plans"."period_months" in (1, 3, 6, 12)
        and "membership_plans"."included_visits" between 0 and 100 and "membership_plans"."discount_percent" between 0 and 50
        and (("membership_plans"."included_service_id" is null) = ("membership_plans"."included_visits" = 0)))
);
--> statement-breakpoint
CREATE TABLE "membership_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_membership_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_visits_one_per_appointment" UNIQUE("tenant_id","appointment_id")
);
--> statement-breakpoint
CREATE TABLE "patient_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"price_halalas" integer NOT NULL,
	"period_months" smallint NOT NULL,
	"included_service_id" uuid,
	"included_visits" smallint DEFAULT 0 NOT NULL,
	"discount_percent" smallint DEFAULT 0 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"renews_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"sold_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_memberships_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "patient_memberships_values" CHECK ("patient_memberships"."ends_on" >= "patient_memberships"."starts_on" and "patient_memberships"."price_halalas" >= 0
        and "patient_memberships"."included_visits" between 0 and 100 and "patient_memberships"."discount_percent" between 0 and 50)
);
--> statement-breakpoint
ALTER TABLE "visit_checkouts" DROP CONSTRAINT "visit_checkouts_amounts";--> statement-breakpoint
ALTER TABLE "visit_charges" ADD COLUMN "covered_by_membership" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_checkouts" ADD COLUMN "discount_halalas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_payments" ADD CONSTRAINT "membership_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_payments" ADD CONSTRAINT "membership_payments_membership_fk" FOREIGN KEY ("tenant_id","patient_membership_id") REFERENCES "public"."patient_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_service_fk" FOREIGN KEY ("tenant_id","included_service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_visits" ADD CONSTRAINT "membership_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_visits" ADD CONSTRAINT "membership_visits_membership_fk" FOREIGN KEY ("tenant_id","patient_membership_id") REFERENCES "public"."patient_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_visits" ADD CONSTRAINT "membership_visits_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_memberships" ADD CONSTRAINT "patient_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_memberships" ADD CONSTRAINT "patient_memberships_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_memberships" ADD CONSTRAINT "patient_memberships_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."membership_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_memberships" ADD CONSTRAINT "patient_memberships_service_fk" FOREIGN KEY ("tenant_id","included_service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_memberships" ADD CONSTRAINT "patient_memberships_renews_fk" FOREIGN KEY ("tenant_id","renews_id") REFERENCES "public"."patient_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_payments_created_idx" ON "membership_payments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_visits_membership_idx" ON "membership_visits" USING btree ("tenant_id","patient_membership_id");--> statement-breakpoint
CREATE INDEX "patient_memberships_patient_idx" ON "patient_memberships" USING btree ("tenant_id","patient_id","ends_on");--> statement-breakpoint
CREATE INDEX "patient_memberships_ends_idx" ON "patient_memberships" USING btree ("tenant_id","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_memberships_one_renewal" ON "patient_memberships" USING btree ("tenant_id","renews_id") WHERE "patient_memberships"."renews_id" is not null;--> statement-breakpoint
ALTER TABLE "visit_checkouts" ADD CONSTRAINT "visit_checkouts_amounts" CHECK ("visit_checkouts"."due_halalas" >= 0 and "visit_checkouts"."discount_halalas" >= 0 and "visit_checkouts"."paid_halalas" >= 0 and ("visit_checkouts"."paid_halalas" = 0 or "visit_checkouts"."method" is not null));