/**
 * "Clear demo patients" (GitHub workflow of the same name): deletes ONE demo clinic's patients and
 * everything attached to them, so the clinic can be shown empty. Doctors, services, prices,
 * settings, the website and other clinics are untouched; the audit log is kept.
 *
 * Demo only, and never a button in the app (a "delete every patient" power has no place in a
 * medical product). It runs as the database admin in ONE transaction and refuses (changing
 * nothing) unless the clinic is a demo clinic whose patients are all fake. To bring the patients
 * back, run "Update demo database" (a full demo rebuild).
 */
import postgres from "postgres";

/** Tables that hold patient data (deleted for the clinic); everything else is kept. */
export const PATIENT_DATA_TABLES = [
  "patients",
  "patient_medical_flags",
  "appointments",
  "reservations", // only rows of appointments; doctors' blocked time stays
  "reschedule_requests",
  "patient_packages",
  "package_payments",
  "package_session_events",
  "files", // consent signatures, lab reports, photos, WhatsApp images: all patient files
  "patient_consents",
  "visit_charges",
  "visit_orders",
  "visit_checkouts",
  "clinical_notes",
  "clinical_note_addenda",
  "verification_codes",
  "rate_limit_hits",
  "patient_sessions",
  "conversations",
  "messages",
  "concern_events",
  "message_dispatches",
  "webhook_events",
  "push_log",
  "dental_chart_entries",
  "dental_plan_items",
  "lab_cases",
  "patient_memberships",
  "membership_payments",
  "membership_visits",
  "lab_reports",
  "lab_values",
  "lab_requests",
  "clinical_photos",
] as const;

export function clearDemoPatientsSql(slug: string): string {
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new Error("bad clinic address");
  const list = PATIENT_DATA_TABLES.map((t) => `'${t}'`).join(", ");
  return `begin;
do $clear$
declare
  tid uuid;
  real_count int;
  t text;
  tables text[];
  pending text[];
  passes int := 0;
  n bigint;
  report text := '';
begin
  select id into tid from public.tenants where slug = '${slug}' and is_demo;
  if tid is null then
    raise exception 'refused: "${slug}" is not a demo clinic';
  end if;

  -- Only the listed tables that exist and belong to clinics (tenant_id).
  select array_agg(c.table_name::text order by c.table_name) into tables
    from information_schema.columns c
   where c.table_schema = 'public' and c.column_name = 'tenant_id'
     and c.table_name = any (array[${list}]);

  -- The admin owns these tables: inside this transaction it lifts FORCE RLS (so it sees the rows)
  -- and the append-only triggers; both come back before the end. Foreign keys stay on.
  foreach t in array tables loop
    execute format('alter table public.%I no force row level security', t);
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  select count(*) into real_count from public.patients where tenant_id = tid and not is_fake;
  if real_count > 0 then
    raise exception 'refused: % patient(s) of "${slug}" are not marked fake', real_count;
  end if;

  -- Delete table by table; a table still pointed at by another waits for the next pass.
  pending := tables;
  while array_length(pending, 1) > 0 loop
    passes := passes + 1;
    if passes > 40 then
      raise exception 'could not delete from: %', array_to_string(pending, ', ');
    end if;
    foreach t in array pending loop
      begin
        if t = 'reservations' then
          execute 'delete from public.reservations where tenant_id = $1 and appointment_id is not null'
            using tid;
        else
          execute format('delete from public.%I where tenant_id = $1', t) using tid;
        end if;
        get diagnostics n = row_count;
        if n > 0 then report := report || t || ' ' || n || '; '; end if;
        pending := array_remove(pending, t);
      exception when foreign_key_violation then
        null;
      end;
    end loop;
  end loop;

  foreach t in array tables loop
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  raise notice 'cleared "${slug}": %', report;
end
$clear$;
commit;
`;
}

/** Runs it as the database admin (Supabase: the "postgres" user, via the session pooler). */
export async function runClearDemoPatients(opts: { adminUrl: string; slug: string }) {
  const notes: string[] = [];
  const db = postgres(opts.adminUrl, {
    max: 1,
    prepare: false,
    onnotice: (n) => notes.push(String(n.message)),
  });
  try {
    await db.unsafe(clearDemoPatientsSql(opts.slug)).simple();
    return notes.join("\n");
  } finally {
    await db.end();
  }
}
