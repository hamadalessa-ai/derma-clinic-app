CREATE TABLE "service_practitioners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_practitioners_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_practitioners_pair_key" UNIQUE("tenant_id","service_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service_practitioners" ADD CONSTRAINT "service_practitioners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_practitioners" ADD CONSTRAINT "service_practitioners_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_practitioners" ADD CONSTRAINT "service_practitioners_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."tenant_members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_practitioners_member_idx" ON "service_practitioners" USING btree ("tenant_id","member_id");