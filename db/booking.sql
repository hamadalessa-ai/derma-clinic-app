-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1 database rules that Drizzle cannot express. Runs after the tables exist
-- and before RLS (db/rls.sql). Everything here works WITHOUT superuser rights.
-- ════════════════════════════════════════════════════════════════════════════

-- Needed so an exclusion constraint can combine "=" on ids with "&&" (overlap) on time ranges.
create extension if not exists btree_gist with schema extensions;

-- ─── No double-booking ──────────────────────────────────────────────────────
-- Two reservations for the same doctor, room or device may never overlap in time.
-- The database checks this itself, so two simultaneous bookings can't both succeed.
-- DEFERRABLE INITIALLY IMMEDIATE: still checked at the end of every statement (so races are
-- refused), but "Refresh demo week" can move a whole week in one go without false clashes.
alter table public.reservations
  add constraint reservations_no_overlap
  exclude using gist (
    tenant_id with =,
    resource_kind with =,
    resource_id with =,
    during with &&
  ) deferrable initially immediate;

create index reservations_lookup_idx on public.reservations
  using gist (tenant_id, resource_kind, resource_id, during);

-- Appointments reserve their doctor, room and device from start until end + buffer.
-- Cancelled and no-show appointments free their slot.
-- A video room (rooms.is_virtual) is not a real room: it is never reserved, so several video
-- consultations can run at once (each doctor is still reserved).
create or replace function public.sync_appointment_reservations() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  slot tstzrange;
begin
  if tg_op = 'UPDATE' then
    delete from public.reservations
      where tenant_id = old.tenant_id and appointment_id = old.id;
  end if;
  if new.status not in ('cancelled', 'no_show') then
    slot := tstzrange(new.starts_at, new.blocked_until, '[)');
    insert into public.reservations (tenant_id, branch_id, resource_kind, resource_id, during, appointment_id)
      values (new.tenant_id, new.branch_id, 'practitioner', new.practitioner_id, slot, new.id);
    if not exists (
      select 1 from public.rooms r
        where r.tenant_id = new.tenant_id and r.id = new.room_id and r.is_virtual
    ) then
      insert into public.reservations (tenant_id, branch_id, resource_kind, resource_id, during, appointment_id)
        values (new.tenant_id, new.branch_id, 'room', new.room_id, slot, new.id);
    end if;
    if new.device_id is not null then
      insert into public.reservations (tenant_id, branch_id, resource_kind, resource_id, during, appointment_id)
        values (new.tenant_id, new.branch_id, 'device', new.device_id, slot, new.id);
    end if;
  end if;
  return null;
end $$;

create trigger appointments_reservations
  after insert or update of branch_id, practitioner_id, room_id, device_id, starts_at, blocked_until, status
  on public.appointments
  for each row execute function public.sync_appointment_reservations();

-- Blocked time (doctor's own block, leave, room/device maintenance) reserves its resource too,
-- so nobody can book over it, and it can't be placed over an existing booking.
create or replace function public.sync_time_block_reservations() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    delete from public.reservations
      where tenant_id = old.tenant_id and time_block_id = old.id;
  end if;
  insert into public.reservations (tenant_id, branch_id, resource_kind, resource_id, during, time_block_id)
    values (
      new.tenant_id, new.branch_id,
      case when new.member_id is not null then 'practitioner'
           when new.room_id is not null then 'room' else 'device' end,
      coalesce(new.member_id, new.room_id, new.device_id),
      tstzrange(new.starts_at, new.ends_at, '[)'),
      new.id);
  return null;
end $$;

create trigger time_blocks_reservations
  after insert or update on public.time_blocks
  for each row execute function public.sync_time_block_reservations();

-- ─── Package balances ───────────────────────────────────────────────────────
-- The balance changes ONLY by recording an event. The CHECK on patient_packages
-- (0 <= used <= total) then rejects anything that would go below zero.
create or replace function public.apply_package_session_event() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  perform set_config('app.package_event', 'on', true);
  update public.patient_packages
    set sessions_used = sessions_used + new.delta, updated_at = now()
    where tenant_id = new.tenant_id and id = new.patient_package_id;
  if not found then
    raise exception 'package % not found', new.patient_package_id;
  end if;
  perform set_config('app.package_event', 'off', true);
  return null;
end $$;

create trigger package_session_events_apply
  after insert on public.package_session_events
  for each row execute function public.apply_package_session_event();

create or replace function public.guard_package_balance() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.sessions_used is distinct from old.sessions_used
     and coalesce(current_setting('app.package_event', true), 'off') <> 'on' then
    raise exception 'package balance can only change through package_session_events';
  end if;
  return new;
end $$;

create trigger patient_packages_guard_balance
  before update on public.patient_packages
  for each row execute function public.guard_package_balance();

-- ─── Clinical notes: signed notes are final ─────────────────────────────────
create or replace function public.guard_clinical_note() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status = 'signed' then
    raise exception 'signed notes cannot be changed; add an addendum instead';
  end if;
  if new.author_user_id is distinct from old.author_user_id
     or new.patient_id is distinct from old.patient_id
     or new.appointment_id is distinct from old.appointment_id then
    raise exception 'note author, patient and visit cannot be changed';
  end if;
  return new;
end $$;

create trigger clinical_notes_guard
  before update on public.clinical_notes
  for each row execute function public.guard_clinical_note();

create or replace function public.guard_note_addendum() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.clinical_notes
    where tenant_id = new.tenant_id and id = new.note_id and status = 'signed'
  ) then
    raise exception 'addenda can only be added to signed notes';
  end if;
  return new;
end $$;

create trigger clinical_note_addenda_guard
  before insert on public.clinical_note_addenda
  for each row execute function public.guard_note_addendum();

-- ─── Search: Arabic-aware normalisation ─────────────────────────────────────
-- "أحمد" = "احمد" = "إحمد", "فاطمة" = "فاطمه", "مصطفى" = "مصطفي", Arabic digits → 0-9,
-- diacritics and tatweel removed, lower-case for English.
create or replace function public.normalize_search(t text) returns text
  language sql immutable parallel safe
  set search_path = ''
as $$
  select regexp_replace(
    translate(lower(coalesce(t, '')), 'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩', 'اااايهوي0123456789'),
    '[ً-ٰٟـ]', '', 'g')
$$;

-- ─── Demo week ──────────────────────────────────────────────────────────────
-- The k-th working day (Friday off) counted from `anchor`. Day 0 is the anchor itself,
-- or the next Saturday when the anchor is a Friday. Used by the demo seed and by
-- "Refresh demo week", so demo appointments always surround today.
create or replace function public.demo_workday(anchor date, k integer) returns date
  language plpgsql immutable
  set search_path = ''
as $$
declare
  d date := anchor;
  steps integer := abs(k);
begin
  while extract(dow from d) = 5 loop d := d + 1; end loop;
  while steps > 0 loop
    d := d + sign(k)::integer;
    if extract(dow from d) <> 5 then steps := steps - 1; end if;
  end loop;
  return d;
end $$;
