CREATE TABLE "clinical_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"file_id" uuid NOT NULL,
	"area" text NOT NULL,
	"view" text NOT NULL,
	"taken_on" date NOT NULL,
	"note" text,
	"taken_by_user_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_photos_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinical_photos_void_reason" CHECK (("clinical_photos"."voided_at" is null) = ("clinical_photos"."void_reason" is null)),
	CONSTRAINT "clinical_photos_area" CHECK (area in ('face', 'forehead', 'cheeks', 'nose', 'chin', 'eyes', 'lips', 'neck', 'scalp', 'chest', 'back', 'abdomen', 'arms', 'hands', 'legs', 'other')),
	CONSTRAINT "clinical_photos_view" CHECK (view in ('front', 'left', 'right', 'close_up'))
);
--> statement-breakpoint
ALTER TABLE "clinical_photos" ADD CONSTRAINT "clinical_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_photos" ADD CONSTRAINT "clinical_photos_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_photos" ADD CONSTRAINT "clinical_photos_appointment_fk" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_photos" ADD CONSTRAINT "clinical_photos_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_photos_patient_idx" ON "clinical_photos" USING btree ("tenant_id","patient_id","area","taken_on");