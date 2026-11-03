-- ════════════════════════════════════════════════════════════════════════════
-- Tenant isolation: restricted app role + Row-Level Security.
-- The app ALWAYS connects as clinic_app. It cannot bypass RLS and does not own any table.
--
-- withTenant() (src/db/tenant.ts) sets, for one transaction only:
--   app.tenant_id   the clinic                       (unset → zero rows everywhere)
--   app.user_id     the signed-in staff user
--   app.roles       e.g. "clinic_admin,practitioner"
--   app.branch_ids  "*" for all branches, or a comma-separated list (unset → no branch rows)
--   app.patient_id  set only for a signed-in PATIENT (role "patient", patient page /my)
-- ════════════════════════════════════════════════════════════════════════════

-- Current clinic for this transaction. NULL when unset → every policy below matches zero rows.
create or replace function public.app_current_tenant() returns uuid
  language sql stable
  set search_path = ''
as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function public.app_current_user() returns text
  language sql stable
  set search_path = ''
as $$ select nullif(current_setting('app.user_id', true), '') $$;

create or replace function public.app_has_role(role_name text) returns boolean
  language sql stable
  set search_path = ''
as $$ select role_name = any(string_to_array(coalesce(current_setting('app.roles', true), ''), ',')) $$;

-- Branch-restricted staff (e.g. a Jeddah-only doctor) only see their branch. Fails closed.
create or replace function public.app_branch_allowed(branch uuid) returns boolean
  language sql stable
  set search_path = ''
as $$
  select coalesce(current_setting('app.branch_ids', true), '') = '*'
      or branch::text = any(string_to_array(coalesce(current_setting('app.branch_ids', true), ''), ','))
$$;

-- ─── Patients (patient page /my) ────────────────────────────────────────────
create or replace function public.app_patient() returns uuid
  language sql stable
  set search_path = ''
as $$ select nullif(current_setting('app.patient_id', true), '')::uuid $$;

create or replace function public.app_is_patient() returns boolean
  language sql stable
  set search_path = ''
as $$ select public.app_has_role('patient') $$;

-- A row about patient `pid` is visible to the signed-in patient when it is them, or someone
-- they are the guardian of (family). The lookup itself goes through RLS on patients.
create or replace function public.app_patient_scope(pid uuid) returns boolean
  language sql stable
  set search_path = ''
as $$
  select pid = public.app_patient()
      or exists (select 1 from public.patients p where p.id = pid and p.guardian_id = public.app_patient())
$$;

-- ─── Privileges ─────────────────────────────────────────────────────────────
grant usage on schema public to clinic_app;
grant execute on function public.app_current_tenant(), public.app_current_user(),
  public.app_has_role(text), public.app_branch_allowed(uuid), public.normalize_search(text),
  public.demo_workday(date, integer), public.app_patient(), public.app_is_patient(),
  public.app_patient_scope(uuid)
  to clinic_app;

-- Clinic directory: read-only (needed to resolve the subdomain before login).
grant select on public.tenants to clinic_app;

-- Staff login tables (no patient data).
grant select, insert, update, delete on public.users, public.sessions, public.accounts,
  public.verifications to clinic_app;

-- Clinic data.
grant select, insert, update, delete on public.branches, public.departments,
  public.tenant_members, public.rooms, public.devices, public.services,
  public.staff_schedules, public.patients, public.branch_holidays,
  public.patient_medical_flags, public.time_blocks, public.package_templates
  to clinic_app;
grant select, update on public.tenant_settings to clinic_app;
-- Appointments are never deleted: they are cancelled (status), which keeps the history.
grant select, insert, update on public.appointments, public.reschedule_requests,
  public.patient_packages to clinic_app;
-- Reservations are written by the booking triggers, which run as clinic_app.
grant select, insert, delete on public.reservations to clinic_app;
-- Append-only records: payments, balance changes, files, signed consents, audit log.
grant select, insert on public.package_payments, public.package_session_events,
  public.files, public.patient_consents, public.audit_logs to clinic_app;
-- Consent template versions are immutable: only the "current" flag may change.
grant select, insert on public.consent_templates to clinic_app;
grant update (is_current) on public.consent_templates to clinic_app;
-- Notes: drafts can be edited (trigger blocks signed ones); never deleted. Addenda: append-only.
grant select, insert on public.clinical_notes, public.clinical_note_addenda to clinic_app;
grant update (body, status, signed_at, updated_at) on public.clinical_notes to clinic_app;
-- Phase 2a: codes, rate limits, patient sessions, message log, push.
grant select, insert, update on public.verification_codes, public.patient_sessions to clinic_app;
grant select, insert, delete on public.rate_limit_hits to clinic_app;
-- Phase 2b: WhatsApp. Messages are a record: never deleted by the app; only their status changes.
grant select, insert, update on public.conversations, public.message_templates to clinic_app;
grant select, insert on public.messages, public.message_dispatches to clinic_app;
grant update (status, status_at, provider_message_id, error_code, error_text) on public.messages to clinic_app;
-- The AI receptionist marks a patient's message as a medical "concern" about their visit (hand-off).
grant update (flag, appointment_id) on public.messages to clinic_app;
grant select, insert, delete on public.webhook_events to clinic_app;
grant select, insert, delete on public.push_log to clinic_app;
-- Consent renewal rules (admin setting). Concern notes/follow-ups/resolutions: append-only.
grant select, insert, update on public.consent_rules to clinic_app;
grant select, insert on public.concern_events to clinic_app;
grant select, insert, update, delete on public.push_subscriptions, public.notification_prefs to clinic_app;
grant delete on public.verification_codes, public.patient_sessions to clinic_app;

-- Supabase's Data API roles must never reach these tables (Data API is off; belt and braces).
do $$
begin
  if exists (select from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
  end if;
end $$;

-- ─── Row-Level Security ─────────────────────────────────────────────────────
-- Tenant tables: a row is visible/writable only when its tenant_id = current clinic.
do $$
declare
  t text;
begin
  foreach t in array array[
    'branches', 'departments', 'tenant_members', 'rooms', 'devices', 'services',
    'staff_schedules', 'patients', 'audit_logs',
    'tenant_settings', 'branch_holidays', 'patient_medical_flags', 'appointments',
    'time_blocks', 'reservations', 'reschedule_requests', 'package_templates',
    'patient_packages', 'package_payments', 'package_session_events', 'files',
    'consent_templates', 'patient_consents', 'clinical_notes', 'clinical_note_addenda',
    'verification_codes', 'rate_limit_hits', 'patient_sessions',
    'conversations', 'messages', 'message_templates', 'message_dispatches', 'webhook_events',
    'push_log', 'consent_rules', 'concern_events',
    'push_subscriptions', 'notification_prefs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for all to clinic_app
         using (tenant_id = public.app_current_tenant())
         with check (tenant_id = public.app_current_tenant())',
      t || '_tenant_isolation', t);
  end loop;
end $$;

-- Branch-scoped tables: ALSO limited to the user's allowed branches ("restrictive" = AND).
do $$
declare
  t text;
begin
  foreach t in array array['appointments', 'time_blocks', 'reservations', 'reschedule_requests'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to clinic_app
         using (public.app_branch_allowed(branch_id))
         with check (public.app_branch_allowed(branch_id))',
      t || '_branch_scope', t);
  end loop;
end $$;

-- Clinical notes: ONLY the practitioner role, enforced by the database itself.
do $$
declare
  t text;
begin
  foreach t in array array['clinical_notes', 'clinical_note_addenda'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to clinic_app
         using (public.app_has_role(''practitioner''))
         with check (public.app_has_role(''practitioner''))',
      t || '_practitioners_only', t);
  end loop;
end $$;

-- Notes and addenda are written in the author's own name; only the author edits a draft.
create policy clinical_notes_author_insert on public.clinical_notes as restrictive
  for insert to clinic_app with check (author_user_id = public.app_current_user());
create policy clinical_notes_author_update on public.clinical_notes as restrictive
  for update to clinic_app using (author_user_id = public.app_current_user());
create policy clinical_note_addenda_author_insert on public.clinical_note_addenda as restrictive
  for insert to clinic_app with check (author_user_id = public.app_current_user());

-- Clinic directory: readable, never writable by the app.
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
create policy tenants_read on public.tenants for select to clinic_app using (true);

-- Staff login tables: global by design (one person can work at several clinics).
-- What a user may see inside a clinic is decided by tenant_members, which IS isolated.
do $$
declare
  t text;
begin
  foreach t in array array['users', 'sessions', 'accounts', 'verifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for all to clinic_app using (true) with check (true)',
      t || '_app_access', t);
  end loop;
end $$;

-- ─── Patient walls ──────────────────────────────────────────────────────────
-- When a PATIENT is signed in (role "patient"), every table is limited further ("restrictive" = AND):
--   * their own rows, and their family's (people they are guardian of) — nobody else's;
--   * a few clinic reference tables (branches, services, …) read-only;
--   * everything else (clinical notes, other patients, audit log, payments, staff logins…) invisible;
--   * NO writes at all: patient actions are checked by the app, then done by the booking engine.
do $$
declare
  t text;
  rule text;
begin
  foreach t in array array[
    'branches', 'departments', 'tenant_members', 'rooms', 'devices', 'services',
    'staff_schedules', 'patients', 'audit_logs',
    'tenant_settings', 'branch_holidays', 'patient_medical_flags', 'appointments',
    'time_blocks', 'reservations', 'reschedule_requests', 'package_templates',
    'patient_packages', 'package_payments', 'package_session_events', 'files',
    'consent_templates', 'patient_consents', 'clinical_notes', 'clinical_note_addenda',
    'verification_codes', 'rate_limit_hits', 'patient_sessions',
    'conversations', 'messages', 'message_templates', 'message_dispatches', 'webhook_events',
    'push_log', 'consent_rules', 'concern_events',
    'push_subscriptions', 'notification_prefs',
    'users', 'sessions', 'accounts', 'verifications'
  ] loop
    rule := case
      when t = 'patients' then 'id = public.app_patient() or guardian_id = public.app_patient()'
      when t in ('appointments', 'patient_packages', 'patient_consents') then 'public.app_patient_scope(patient_id)'
      when t in ('branches', 'departments', 'services', 'rooms', 'tenant_members', 'consent_templates', 'consent_rules', 'tenant_settings') then 'true'
      else 'false'
    end;
    execute format(
      'create policy %I on public.%I as restrictive for all to clinic_app
         using (not public.app_is_patient() or (%s))
         with check (not public.app_is_patient())',
      t || '_patient_wall', t, rule);
  end loop;
end $$;

-- Push subscriptions and notification choices belong to one staff member. System work
-- (sending notifications, no signed-in user) may read them; a signed-in user sees only their own.
do $$
declare
  t text;
begin
  foreach t in array array['push_subscriptions', 'notification_prefs'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to clinic_app
         using (public.app_current_user() is null or user_id = public.app_current_user())
         with check (public.app_current_user() is null or user_id = public.app_current_user())',
      t || '_own_only', t);
  end loop;
end $$;
