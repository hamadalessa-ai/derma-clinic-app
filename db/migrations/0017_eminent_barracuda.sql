CREATE TYPE "public"."billing_item_kind" AS ENUM('product', 'consumable', 'procedure', 'other');--> statement-breakpoint
CREATE TYPE "public"."visit_order_kind" AS ENUM('medication', 'treatment');--> statement-breakpoint
CREATE TABLE "billing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"kind" "billing_item_kind" DEFAULT 'other' NOT NULL,
	"price_halalas" integer DEFAULT 0 NOT NULL,
	"unit_ar" text,
	"unit_en" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_items_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "billing_items_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "billing_items_price" CHECK ("billing_items"."price_halalas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "visit_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid,
	"billing_item_id" uuid,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_halalas" integer NOT NULL,
	"covered_by_package" boolean DEFAULT false NOT NULL,
	"added_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_charges_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "visit_charges_quantity" CHECK ("visit_charges"."quantity" between 1 and 1000),
	CONSTRAINT "visit_charges_price" CHECK ("visit_charges"."unit_price_halalas" >= 0),
	CONSTRAINT "visit_charges_source" CHECK (("visit_charges"."service_id" is null) <> ("visit_charges"."billing_item_id" is null))
);
--> statement-breakpoint
CREATE TABLE "visit_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "visit_order_kind" NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"frequency" text,
	"duration" text,
	"sessions" integer,
	"interval_weeks" integer,
	"service_id" uuid,
	"instructions" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_orders_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "visit_orders_sessions" CHECK ("visit_orders"."sessions" is null or "visit_orders"."sessions" between 1 and 50),
	CONSTRAINT "visit_orders_interval" CHECK ("visit_orders"."interval_weeks" is null or "visit_orders"."interval_weeks" between 1 and 104)
);
--> statement-breakpoint
ALTER TABLE "billing_items" ADD CONSTRAINT "billing_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_charges" ADD CONSTRAINT "visit_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_charges" ADD CONSTRAINT "visit_charges_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_charges" ADD CONSTRAINT "visit_charges_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_charges" ADD CONSTRAINT "visit_charges_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_charges" ADD CONSTRAINT "visit_charges_item_fk" FOREIGN KEY ("tenant_id","billing_item_id") REFERENCES "public"."billing_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_orders" ADD CONSTRAINT "visit_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_orders" ADD CONSTRAINT "visit_orders_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_orders" ADD CONSTRAINT "visit_orders_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_orders" ADD CONSTRAINT "visit_orders_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_charges_appointment_idx" ON "visit_charges" USING btree ("tenant_id","appointment_id");--> statement-breakpoint
CREATE INDEX "visit_orders_appointment_idx" ON "visit_orders" USING btree ("tenant_id","appointment_id");--> statement-breakpoint
CREATE INDEX "visit_orders_patient_idx" ON "visit_orders" USING btree ("tenant_id","patient_id");