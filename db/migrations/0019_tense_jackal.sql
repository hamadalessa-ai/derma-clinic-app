CREATE TABLE "visit_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"due_halalas" integer NOT NULL,
	"paid_halalas" integer NOT NULL,
	"method" "payment_method",
	"invoice_number" text,
	"note" text,
	"checked_out_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_checkouts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "visit_checkouts_one_per_visit" UNIQUE("tenant_id","appointment_id"),
	CONSTRAINT "visit_checkouts_amounts" CHECK ("visit_checkouts"."due_halalas" >= 0 and "visit_checkouts"."paid_halalas" >= 0 and ("visit_checkouts"."paid_halalas" = 0 or "visit_checkouts"."method" is not null))
);
--> statement-breakpoint
ALTER TABLE "visit_checkouts" ADD CONSTRAINT "visit_checkouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_checkouts" ADD CONSTRAINT "visit_checkouts_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_checkouts" ADD CONSTRAINT "visit_checkouts_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_checkouts_created_idx" ON "visit_checkouts" USING btree ("tenant_id","created_at");