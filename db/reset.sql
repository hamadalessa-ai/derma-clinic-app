-- ════════════════════════════════════════════════════════════════════════════
-- DANGER: deletes ALL app tables and data (demo only). Paste into Supabase SQL Editor,
-- then run db/setup.sql again. Does not touch anything else in the database.
-- ════════════════════════════════════════════════════════════════════════════
begin;
drop table if exists public.audit_logs, public.patients, public.staff_schedules,
  public.services, public.devices, public.rooms, public.tenant_members,
  public.verifications, public.accounts, public.sessions, public.users,
  public.departments, public.branches, public.tenants cascade;
drop type if exists public.member_role, public.gender;
drop function if exists public.app_current_tenant();
do $$
begin
  if exists (select from pg_roles where rolname = 'clinic_app') then
    execute 'drop owned by clinic_app';
  end if;
end $$;
commit;
select 'Reset complete. Now run db/setup.sql.' as result;
