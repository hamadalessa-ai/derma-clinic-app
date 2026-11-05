CREATE INDEX "appointments_status_start_idx" ON "appointments" USING btree ("tenant_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "clinical_notes_author_status_idx" ON "clinical_notes" USING btree ("tenant_id","author_user_id","status");--> statement-breakpoint
CREATE INDEX "clinical_notes_appointment_idx" ON "clinical_notes" USING btree ("tenant_id","appointment_id");--> statement-breakpoint
CREATE INDEX "messages_patient_idx" ON "messages" USING btree ("tenant_id","patient_id","created_at");