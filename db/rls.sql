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
-- New clinic (platform owner, checked in the app): creates the clinic and its settings row only.
-- clinic_app can't write the clinic directory itself; this function does exactly this one insert.
create or replace function public.app_create_clinic(
  p_slug text, p_name_ar text, p_name_en text, p_brand text, p_is_demo boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
begin
  -- Only a platform owner (the signed-in user the app told us about) may open a new clinic.
  if not exists (select 1 from public.users u
                 where u.id = public.app_current_user() and u.is_platform_owner) then
    raise exception 'only the platform owner can add a clinic' using errcode = '42501';
  end if;
  if p_slug !~ '^[a-z][a-z0-9-]{0,28}[a-z0-9]$' or p_slug in ('www', 'app', 'api', 'admin') then
    raise exception 'invalid clinic address' using errcode = '22023';
  end if;
  if p_brand !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid colour' using errcode = '22023';
  end if;
  -- No RETURNING: the function's owner may add the row but (on purpose) has no read policy.
  tid := gen_random_uuid();
  insert into public.tenants (id, slug, name_ar, name_en, brand_color, is_demo)
    values (tid, p_slug, p_name_ar, p_name_en, p_brand, p_is_demo);
  insert into public.tenant_settings (tenant_id) values (tid);
  return tid;
end;
$$;
revoke all on function public.app_create_clinic(text, text, text, text, boolean) from public;
grant execute on function public.app_create_clinic(text, text, text, text, boolean) to clinic_app;

-- Clinic status (platform owner only): active, read_only, suspended, closed. Returns the old status.
create or replace function public.app_set_clinic_status(
  p_tenant uuid, p_status public.clinic_status, p_reason text
) returns public.clinic_status
language plpgsql security definer set search_path = public as $$
declare
  old_status public.clinic_status;
begin
  if not exists (select 1 from public.users u
                 where u.id = public.app_current_user() and u.is_platform_owner) then
    raise exception 'only the platform owner can change a clinic status' using errcode = '42501';
  end if;
  select status into old_status from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'clinic not found' using errcode = '22023';
  end if;
  update public.tenants
     set status = p_status,
         status_reason = nullif(left(trim(coalesce(p_reason, '')), 300), ''),
         status_changed_at = now(),
         paused_for_billing = false  -- the owner decided by hand
   where id = p_tenant;
  return old_status;
end;
$$;
revoke all on function public.app_set_clinic_status(uuid, public.clinic_status, text) from public;
grant execute on function public.app_set_clinic_status(uuid, public.clinic_status, text) to clinic_app;

-- Monthly usage limits (platform owner only). NULL = no limit.
create or replace function public.app_set_clinic_limits(
  p_tenant uuid, p_ai integer, p_whatsapp integer
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u
                 where u.id = public.app_current_user() and u.is_platform_owner) then
    raise exception 'only the platform owner can change clinic limits' using errcode = '42501';
  end if;
  if coalesce(p_ai, 0) < 0 or coalesce(p_whatsapp, 0) < 0 then
    raise exception 'limits cannot be negative' using errcode = '22023';
  end if;
  update public.tenants
     set limits = jsonb_strip_nulls(jsonb_build_object('aiMonthly', p_ai, 'whatsappMonthly', p_whatsapp))
   where id = p_tenant;
  if not found then
    raise exception 'clinic not found' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.app_set_clinic_limits(uuid, integer, integer) from public;
grant execute on function public.app_set_clinic_limits(uuid, integer, integer) to clinic_app;

-- WhatsApp connection of a clinic (its number at Meta + optional encrypted token + live switch).
-- Platform owner only. p_token_enc: null = keep the stored token, '' = remove it (use the platform's).
create or replace function public.app_set_clinic_whatsapp(
  p_tenant uuid, p_phone_number_id text, p_business_account_id text, p_display_phone text,
  p_token_enc text, p_live boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u
                 where u.id = public.app_current_user() and u.is_platform_owner) then
    raise exception 'only the platform owner can connect WhatsApp' using errcode = '42501';
  end if;
  if p_live and coalesce(p_phone_number_id, '') = '' then
    raise exception 'a live WhatsApp connection needs a phone number id' using errcode = '22023';
  end if;
  update public.tenants
     set whatsapp_phone_number_id = nullif(trim(p_phone_number_id), ''),
         whatsapp_business_account_id = nullif(trim(p_business_account_id), ''),
         whatsapp_display_phone = nullif(trim(p_display_phone), ''),
         whatsapp_token_enc = case when p_token_enc is null then whatsapp_token_enc
                                   else nullif(p_token_enc, '') end,
         whatsapp_live = p_live
   where id = p_tenant;
  if not found then
    raise exception 'clinic not found' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.app_set_clinic_whatsapp(uuid, text, text, text, text, boolean) from public;
grant execute on function public.app_set_clinic_whatsapp(uuid, text, text, text, text, boolean) to clinic_app;

-- Subscription: plan, monthly price (halalas, before VAT), trial end, grace days. Platform owner only.
create or replace function public.app_set_clinic_plan(
  p_tenant uuid, p_plan public.plan_tier, p_price integer, p_trial_ends date, p_grace integer
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u
                 where u.id = public.app_current_user() and u.is_platform_owner) then
    raise exception 'only the platform owner can change a subscription' using errcode = '42501';
  end if;
  if p_price < 0 or p_grace < 0 or p_grace > 90 then
    raise exception 'invalid subscription values' using errcode = '22023';
  end if;
  update public.tenants
     set plan = p_plan, monthly_price_halalas = p_price, trial_ends_on = p_trial_ends,
         billing_grace_days = p_grace
   where id = p_tenant;
  if not found then
    raise exception 'clinic not found' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.app_set_clinic_plan(uuid, public.plan_tier, integer, date, integer) from public;
grant execute on function public.app_set_clinic_plan(uuid, public.plan_tier, integer, date, integer) to clinic_app;

-- Billing rule, decided by the data itself (so anyone may ask it to run, e.g. the daily job):
-- an unpaid statement past its due date + grace days → an ACTIVE clinic becomes read-only
-- ("paused for billing"); once nothing is overdue, a clinic paused for billing becomes active again.
-- A status the owner set by hand is never changed here. Returns the clinic's status afterwards.
create or replace function public.app_billing_enforce(p_tenant uuid) returns public.clinic_status
language plpgsql security definer set search_path = public as $$
declare
  t record;
  overdue boolean;
  today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  select status, paused_for_billing, billing_grace_days into t
    from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'clinic not found' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.platform_statements s
     where s.tenant_id = p_tenant and s.status = 'issued'
       and s.due_on + t.billing_grace_days < today
  ) into overdue;
  if overdue and t.status = 'active' then
    update public.tenants
       set status = 'read_only', paused_for_billing = true, status_changed_at = now(),
           status_reason = 'Payment overdue · السداد متأخر'
     where id = p_tenant;
    return 'read_only';
  elsif not overdue and t.paused_for_billing and t.status = 'read_only' then
    update public.tenants
       set status = 'active', paused_for_billing = false, status_changed_at = now(),
           status_reason = null
     where id = p_tenant;
    return 'active';
  end if;
  return t.status;
end;
$$;
revoke all on function public.app_billing_enforce(uuid) from public;
grant execute on function public.app_billing_enforce(uuid) to clinic_app;

-- Is the signed-in user a platform owner?
create or replace function public.app_is_platform_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u
                  where u.id = public.app_current_user() and u.is_platform_owner)
$$;

-- No backdoor to patient data: a platform owner who is not a member of this clinic sees its patient
-- tables ONLY while the clinic's admin has granted support access (support_grants, not expired or
-- ended). Everyone else (staff, patients, system work without a user) is not affected by this rule.
create or replace function public.app_platform_gate() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.app_is_platform_owner() then true
    when exists (select 1 from public.tenant_members m
                  where m.user_id = public.app_current_user()
                    and m.tenant_id = public.app_current_tenant()
                    and m.deactivated_at is null) then true
    else exists (select 1 from public.support_grants g
                  where g.tenant_id = public.app_current_tenant()
                    and g.revoked_at is null and g.expires_at > now())
  end
$$;

grant execute on function public.app_current_tenant(), public.app_current_user(),
  public.app_has_role(text), public.app_branch_allowed(uuid), public.normalize_search(text),
  public.demo_workday(date, integer), public.app_patient(), public.app_is_patient(),
  public.app_patient_scope(uuid), public.app_is_platform_owner(), public.app_platform_gate()
  to clinic_app;

-- Clinic directory: read-only (needed to resolve the subdomain before login).
grant select on public.tenants to clinic_app;

-- Staff login tables (no patient data).
grant select, insert, update, delete on public.users, public.sessions, public.accounts,
  public.verifications, public.two_factors to clinic_app;
-- Global rate-limit counters (hashed buckets, no clinic data): add and count; old rows purged daily.
grant select, insert, delete on public.global_rate_hits to clinic_app;

-- Clinic data.
grant select, insert, update, delete on public.branches, public.departments,
  public.tenant_members, public.rooms, public.devices, public.services,
  public.staff_schedules, public.patients, public.branch_holidays,
  public.patient_medical_flags, public.time_blocks, public.package_templates
  to clinic_app;
-- One-off schedule changes (day off / special hours): added and removed, never edited.
grant select, insert, delete on public.schedule_exceptions to clinic_app;
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
grant update (body, status, signed_at, updated_at, ai_drafted_at) on public.clinical_notes to clinic_app;
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
-- Platform billing: the clinic reads its own; only platform work writes (policies below).
grant select, insert on public.platform_statements, public.platform_payments to clinic_app;
grant update (status, paid_at, voided_at) on public.platform_statements to clinic_app;
-- Support access: granted and ended by the clinic admin (policies below); never deleted.
grant select, insert on public.support_grants to clinic_app;
grant update (revoked_at, revoked_by) on public.support_grants to clinic_app;
-- Which doctors do which service (clinic admin): rows added and removed, never edited.
grant select, insert, delete on public.service_practitioners to clinic_app;

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
    'push_subscriptions', 'notification_prefs', 'schedule_exceptions',
    'platform_statements', 'platform_payments', 'support_grants', 'service_practitioners'
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
-- New clinics are created only by public.app_create_clinic() (runs as its owner, not clinic_app).
create policy tenants_create on public.tenants for insert
  with check (current_user <> 'clinic_app');
create policy tenant_settings_create on public.tenant_settings for insert
  with check (current_user <> 'clinic_app');
-- The platform functions above (running as the table owner) may also read and update the directory.
create policy tenants_owner_read on public.tenants for select
  using (current_user <> 'clinic_app');
create policy tenants_owner_update on public.tenants for update
  using (current_user <> 'clinic_app') with check (current_user <> 'clinic_app');

-- Platform billing rows: written only by platform work (the platform owner, or the daily job
-- acting for the platform), never by clinic staff. The billing rule above may read them.
do $$
declare
  t text;
begin
  foreach t in array array['platform_statements', 'platform_payments'] loop
    execute format(
      'create policy %I on public.%I as restrictive for insert to clinic_app
         with check (public.app_has_role(''platform_owner''))', t || '_platform_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to clinic_app
         using (public.app_has_role(''platform_owner''))', t || '_platform_update', t);
    execute format(
      'create policy %I on public.%I for select using (current_user <> ''clinic_app'')',
      t || '_owner_read', t);
  end loop;
end $$;

-- Support grants: only a clinic admin of this clinic (never a platform owner, even during a
-- support session) may give or end access.
create policy support_grants_admin_insert on public.support_grants as restrictive
  for insert to clinic_app
  with check (public.app_has_role('clinic_admin') and not public.app_is_platform_owner());
create policy support_grants_admin_update on public.support_grants as restrictive
  for update to clinic_app
  using (public.app_has_role('clinic_admin') and not public.app_is_platform_owner());
-- The gate functions (running as the table owner) read memberships and grants.
create policy tenant_members_owner_read on public.tenant_members for select
  using (current_user <> 'clinic_app');
create policy support_grants_owner_read on public.support_grants for select
  using (current_user <> 'clinic_app');

-- The platform gate on every table holding patient data (see app_platform_gate()).
do $$
declare
  t text;
begin
  foreach t in array array[
    'patients', 'patient_medical_flags', 'appointments', 'patient_packages', 'package_payments',
    'package_session_events', 'files', 'patient_consents', 'clinical_notes', 'clinical_note_addenda',
    'conversations', 'messages', 'concern_events', 'reschedule_requests'
  ] loop
    execute format(
      -- Cheap first test: no signed-in user (patients, system work) → not a platform owner.
      'create policy %I on public.%I as restrictive for all to clinic_app
         using (public.app_current_user() is null or (select public.app_platform_gate()))
         with check (public.app_current_user() is null or (select public.app_platform_gate()))',
      t || '_platform_gate', t);
  end loop;
end $$;

-- Staff login tables: global by design (one person can work at several clinics).
-- What a user may see inside a clinic is decided by tenant_members, which IS isolated.
do $$
declare
  t text;
begin
  foreach t in array array['users', 'sessions', 'accounts', 'verifications', 'two_factors',
                           'global_rate_hits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for all to clinic_app using (true) with check (true)',
      t || '_app_access', t);
  end loop;
end $$;
-- app_create_clinic() (runs as the table owner) checks that the caller is a platform owner.
create policy users_owner_lookup on public.users for select
  using (current_user <> 'clinic_app');

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
    'push_subscriptions', 'notification_prefs', 'schedule_exceptions',
    'platform_statements', 'platform_payments', 'support_grants', 'service_practitioners',
    'users', 'sessions', 'accounts', 'verifications', 'two_factors', 'global_rate_hits'
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
