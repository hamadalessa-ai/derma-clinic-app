CREATE TYPE "public"."plan_tier" AS ENUM('basic', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('issued', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "platform_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"received_on" date NOT NULL,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_payments_positive" CHECK ("platform_payments"."amount_halalas" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_halalas" integer NOT NULL,
	"vat_halalas" integer NOT NULL,
	"total_halalas" integer NOT NULL,
	"due_on" date NOT NULL,
	"status" "statement_status" DEFAULT 'issued' NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_statements_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "platform_statements_number_key" UNIQUE("number"),
	CONSTRAINT "platform_statements_amounts" CHECK ("platform_statements"."amount_halalas" >= 0 and "platform_statements"."vat_halalas" >= 0 and "platform_statements"."total_halalas" = "platform_statements"."amount_halalas" + "platform_statements"."vat_halalas")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" "plan_tier" DEFAULT 'pro' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "monthly_price_halalas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_on" date;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_grace_days" smallint DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "paused_for_billing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_statement_fk" FOREIGN KEY ("tenant_id","statement_id") REFERENCES "public"."platform_statements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_statements" ADD CONSTRAINT "platform_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_statements_one_per_period" ON "platform_statements" USING btree ("tenant_id","period_start") WHERE "platform_statements"."status" <> 'void';