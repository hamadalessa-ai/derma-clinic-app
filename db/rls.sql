-- ════════════════════════════════════════════════════════════════════════════
-- Tenant isolation: restricted app role + Row-Level Security.
-- The app ALWAYS connects as clinic_app. It cannot bypass RLS and does not own any table.
-- ════════════════════════════════════════════════════════════════════════════

-- Current clinic for this transaction. NULL when unset → every policy below matches zero rows.
create or replace function public.app_current_tenant() returns uuid
  language sql stable
  set search_path = ''
as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- ─── Privileges ─────────────────────────────────────────────────────────────
grant usage on schema public to clinic_app;
grant execute on function public.app_current_tenant() to clinic_app;

-- Clinic directory: read-only (needed to resolve the subdomain before login).
grant select on public.tenants to clinic_app;

-- Staff login tables (no patient data).
grant select, insert, update, delete on public.users, public.sessions, public.accounts,
  public.verifications to clinic_app;

-- Clinic data.
grant select, insert, update, delete on public.branches, public.departments,
  public.tenant_members, public.rooms, public.devices, public.services,
  public.staff_schedules, public.patients to clinic_app;

-- Audit log is append-only for the app: no update, no delete.
grant select, insert on public.audit_logs to clinic_app;

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
    'staff_schedules', 'patients', 'audit_logs'
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
