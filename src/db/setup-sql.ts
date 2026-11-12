/**
 * Builds db/setup.sql: ONE file that creates the whole demo database in a single transaction.
 * It is pasted into the Supabase SQL Editor, so the admin password never leaves Supabase.
 *
 * Order matters: tables → demo data → app role + RLS. Data is inserted before FORCE RLS
 * is switched on; afterwards only clinic_app (inside withTenant) can touch clinic rows.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { insert, lit, raw } from "./sql-render";
import { SERVICE_TEXTS, TEMPLATE_KINDS, TEMPLATES } from "../lib/whatsapp/catalog";
import { demoSql } from "./demo-sql";
import {
  AI_RECEPTIONIST,
  AI_SCRIBE,
  demoId,
  PLATFORM_OWNER,
  SEED_TENANTS,
  CONSENT_TEMPLATES,
  DERMA_MEDICAL_FLAGS,
  PACKAGE_TEMPLATES,
  SERVICE_CONSENTS,
  DOCTORS_MANAGE_OWN_SCHEDULE,
  LAMSA_MEDICAL_FLAGS,
  HOLIDAYS,
  ONLINE_SERVICES,
  ONLINE_SETTINGS,
  STAFF_GENDER,
  WHATSAPP_OPTED_OUT,
  WORK_HOURS,
  WORK_WEEK,
  SITE_CONTENT,
  STAFF_PROFILE,
  VIRTUAL_ROOMS,
  type SeedTenant,
} from "./seed-data";

export const APP_PASSWORD_PLACEHOLDER = "CHANGE_ME_APP_DB_PASSWORD";
export const DEMO_PASSWORD_PLACEHOLDER = "CHANGE_ME_DEMO_PASSWORD";

const ROOT = path.resolve(__dirname, "../..");

/** Password hash computed once inside Postgres with pgcrypto bcrypt (verified by bcryptjs). */
const PASSWORD_HASH = "(select demo_password_hash from pg_temp.setup_params)";

function userInsert(
  id: string,
  email: string,
  nameAr: string,
  nameEn: string,
  isPlatformOwner = false,
) {
  return (
    `insert into public.users (id, name, name_en, email, email_verified, is_platform_owner) values ` +
    `(${lit(id)}, ${lit(nameAr)}, ${lit(nameEn)}, ${lit(email)}, true, ${isPlatformOwner});\n` +
    `insert into public.accounts (id, account_id, provider_id, user_id, password) values ` +
    `(${lit(`acc_${id}`)}, ${lit(id)}, 'credential', ${lit(id)}, ${PASSWORD_HASH});\n`
  );
}

function tenantSql(t: SeedTenant): string {
  const tid = demoId(`tenant:${t.slug}`);
  const ref = (kind: string, key: string) => demoId(`${t.slug}:${kind}:${key}`);
  const out: string[] = [`-- ── ${t.nameEn} (${t.slug}) ──`];

  out.push(
    insert("tenants", [
      {
        id: tid,
        slug: t.slug,
        name_ar: t.nameAr,
        name_en: t.nameEn,
        brand_color: t.brandColor,
        plan: "pro",
        monthly_price_halalas: 100000, // sample price; demo clinics are never billed automatically
      },
    ]),
  );
  out.push(
    insert(
      "branches",
      t.branches.map((b, i) => ({
        id: ref("branch", b.key),
        tenant_id: tid,
        name_ar: b.nameAr,
        name_en: b.nameEn,
        city_ar: b.cityAr,
        city_en: b.cityEn,
        map_url: `https://maps.google.com/?q=${encodeURIComponent(`${t.nameEn} ${b.cityEn}`)}`,
        sort_order: i,
      })),
    ),
  );
  out.push(
    insert(
      "departments",
      t.departments.map((d, i) => ({
        id: ref("department", d.code),
        tenant_id: tid,
        code: d.code,
        name_ar: d.nameAr,
        name_en: d.nameEn,
        is_active: d.isActive,
        sort_order: i,
      })),
    ),
  );
  out.push(
    insert(
      "rooms",
      t.rooms.map((r) => ({
        id: ref("room", r.key),
        tenant_id: tid,
        branch_id: ref("branch", r.branch),
        name_ar: r.nameAr,
        name_en: r.nameEn,
      })),
    ),
  );
  if (VIRTUAL_ROOMS[t.slug]?.length) {
    out.push(
      insert(
        "rooms",
        VIRTUAL_ROOMS[t.slug].map((r) => ({
          id: ref("room", r.key),
          tenant_id: tid,
          branch_id: ref("branch", r.branch),
          name_ar: r.nameAr,
          name_en: r.nameEn,
          is_virtual: true,
        })),
      ),
    );
  }
  out.push(
    insert(
      "devices",
      t.devices.map((d) => ({
        id: ref("device", d.key),
        tenant_id: tid,
        branch_id: ref("branch", d.branch),
        room_id: d.room ? ref("room", d.room) : null,
        device_type: d.deviceType,
        name_ar: d.nameAr,
        name_en: d.nameEn,
      })),
    ),
  );
  for (const s of t.staff) {
    out.push(userInsert(`usr_${s.key}`, s.email, s.nameAr, s.nameEn));
  }
  out.push(
    insert(
      "tenant_members",
      t.staff.map((s) => ({
        id: ref("member", s.key),
        tenant_id: tid,
        user_id: `usr_${s.key}`,
        roles: `{${s.roles.join(",")}}`,
        branch_id: s.branch ? ref("branch", s.branch) : null,
        title_ar: s.titleAr,
        title_en: s.titleEn,
        gender: STAFF_GENDER[s.key] ?? null,
        profile: STAFF_PROFILE[s.key] ? JSON.stringify(STAFF_PROFILE[s.key]) : null,
      })),
    ),
  );
  out.push(
    insert(
      "staff_schedules",
      t.staff
        .filter((s) => s.branch !== null)
        .flatMap((s) =>
          WORK_WEEK.map((weekday) => ({
            tenant_id: tid,
            member_id: ref("member", s.key),
            branch_id: ref("branch", s.branch!),
            weekday,
            start_time: WORK_HOURS.start,
            end_time: WORK_HOURS.end,
            break_start: WORK_HOURS.breakStart,
            break_end: WORK_HOURS.breakEnd,
          })),
        ),
    ),
  );
  out.push(
    insert(
      "services",
      t.services.map((s, i) => ({
        id: ref("service", s.code),
        tenant_id: tid,
        department_id: ref("department", "dermatology"),
        code: s.code,
        name_ar: s.nameAr,
        name_en: s.nameEn,
        duration_minutes: s.durationMinutes,
        buffer_minutes: s.bufferMinutes,
        price_halalas: Math.round(s.priceSar * 100),
        required_device_type: s.requiredDeviceType,
        consent_code: SERVICE_CONSENTS[s.code] ?? null,
        is_demo_value: true,
        online_bookable: (ONLINE_SERVICES[t.slug] ?? []).includes(s.code),
        is_virtual: s.isVirtual ?? false,
        pre_visit_ar: SERVICE_TEXTS[s.code]?.preVisitAr ?? null,
        pre_visit_en: SERVICE_TEXTS[s.code]?.preVisitEn ?? null,
        post_care_ar: SERVICE_TEXTS[s.code]?.postCareAr ?? null,
        post_care_en: SERVICE_TEXTS[s.code]?.postCareEn ?? null,
        recall_after_days: SERVICE_TEXTS[s.code]?.recallAfterDays ?? null,
        // Video consultations first, so reception and the AI receptionist see them at the top.
        sort_order: s.isVirtual ? 0 : i + 1,
      })),
    ),
  );
  // Which doctors do a service (none listed = every doctor). Demo: one less-used service lists
  // all of the clinic's doctors, so nothing changes for booking.
  const doctors = t.staff.filter((s) => s.roles.includes("practitioner"));
  const firstService =
    t.services.find((s) => s.code === "exosomes") ?? t.services.find((s) => s.code === "fillers");
  if (firstService && doctors.length) {
    out.push(
      insert(
        "service_practitioners",
        doctors.map((d) => ({
          tenant_id: tid,
          service_id: ref("service", firstService.code),
          member_id: ref("member", d.key),
        })),
      ),
    );
  }
  out.push(
    insert(
      "patients",
      t.patients.map((p) => ({
        id: ref("patient", p.fileNumber),
        tenant_id: tid,
        file_number: p.fileNumber,
        full_name_ar: p.fullNameAr,
        full_name_en: p.fullNameEn,
        phone: p.phone,
        gender: p.gender,
        date_of_birth: p.dateOfBirth,
        id_type: p.idType,
        id_number: p.idNumber,
        guardian_id: p.guardian ? ref("patient", p.guardian.fileNumber) : null,
        guardian_relation_ar: p.guardian?.relationAr ?? null,
        guardian_relation_en: p.guardian?.relationEn ?? null,
        is_fake: true,
        // Demo: everyone agreed to WhatsApp messages, except one patient who sent STOP.
        whatsapp_opt_in_at: raw("now() - interval '60 days'"),
        whatsapp_opt_in_source: "demo",
        whatsapp_opted_out_at:
          p.fileNumber === WHATSAPP_OPTED_OUT ? raw("now() - interval '5 days'") : null,
      })),
    ),
  );
  out.push(
    insert(
      "patient_medical_flags",
      (t.slug === "derma" ? DERMA_MEDICAL_FLAGS : LAMSA_MEDICAL_FLAGS).map((f) => ({
        tenant_id: tid,
        patient_id: ref("patient", f.fileNumber),
        kind: f.kind,
        label: f.label,
        note: f.note ?? null,
      })),
    ),
  );
  out.push(
    insert(
      "consent_templates",
      CONSENT_TEMPLATES.map((c) => ({
        id: ref("consent_template", `${c.code}:v1`),
        tenant_id: tid,
        code: c.code,
        version: 1,
        is_current: true,
        title_ar: c.titleAr,
        title_en: c.titleEn,
        body_ar: c.bodyAr,
        body_en: c.bodyEn,
      })),
    ),
  );
  // Renewal rules: Botox/fillers and peels every visit; laser hair removal once per package;
  // video consultations: one signature valid 12 months.
  out.push(
    insert(
      "consent_rules",
      CONSENT_TEMPLATES.map((c) => ({
        tenant_id: tid,
        code: c.code,
        rule: c.rule,
        months: c.months ?? null,
      })),
    ),
  );
  out.push(
    insert(
      "package_templates",
      (PACKAGE_TEMPLATES[t.slug] ?? []).map((p) => ({
        id: ref("package_template", p.key),
        tenant_id: tid,
        service_id: ref("service", p.serviceCode),
        name_ar: p.nameAr,
        name_en: p.nameEn,
        sessions_count: p.sessions,
        price_halalas: p.priceSar * 100,
        validity_days: p.validityDays,
      })),
    ),
  );
  out.push(
    insert("tenant_settings", [
      {
        tenant_id: tid,
        doctors_manage_own_schedule: DOCTORS_MANAGE_OWN_SCHEDULE[t.slug] ?? false,
        online_booking_enabled: ONLINE_SETTINGS[t.slug]?.enabled ?? false,
        online_requires_approval: ONLINE_SETTINGS[t.slug]?.requiresApproval ?? false,
        show_prices_online: ONLINE_SETTINGS[t.slug]?.showPrices ?? true,
        ai_receptionist_enabled: AI_RECEPTIONIST[t.slug] ?? false,
        ai_scribe_enabled: AI_SCRIBE[t.slug] ?? false,
        site: JSON.stringify(SITE_CONTENT[t.slug] ?? {}),
        demo_anchor_day: raw("(select demo_anchor from pg_temp.setup_params)"),
      },
    ]),
  );
  out.push(
    insert(
      "message_templates",
      TEMPLATE_KINDS.map((kind) => ({
        tenant_id: tid,
        kind,
        enabled: true,
        body_ar: TEMPLATES[kind].bodyAr,
        body_en: TEMPLATES[kind].bodyEn,
        meta_name: TEMPLATES[kind].metaName,
        category: "utility",
      })),
    ),
  );
  out.push(
    insert(
      "branch_holidays",
      HOLIDAYS.map((h) => ({
        tenant_id: tid,
        branch_id: null,
        day: h.day,
        name_ar: h.nameAr,
        name_en: h.nameEn,
      })),
    ),
  );
  out.push(
    insert("audit_logs", [
      {
        tenant_id: tid,
        actor_user_id: null,
        action: "tenant.seed",
        entity_type: "tenant",
        entity_id: tid,
      },
    ]),
  );
  return out.filter(Boolean).join("\n");
}

/**
 * drizzle-kit sometimes emits a composite FOREIGN KEY before the UNIQUE constraint it
 * points at. Within each migration file, run statements in a safe order:
 * types/tables/new columns → unique constraints → everything else (keeping their relative order).
 * (It can also emit a UNIQUE constraint before the ADD COLUMN it is on.)
 */
export function orderMigrationStatements(fileSql: string): string {
  const statements = fileSql
    .split("--> statement-breakpoint")
    .map((st) => st.trim())
    .filter(Boolean);
  const rank = (st: string) =>
    /^CREATE (TYPE|TABLE)\b/i.test(st) || /^ALTER TABLE "[^"]+" ADD COLUMN\b/i.test(st)
      ? 0
      : /ADD CONSTRAINT "[^"]+" UNIQUE\(/i.test(st)
        ? 1
        : 2;
  return statements
    .map((st, i) => ({ st, i, r: rank(st) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.st)
    .join("\n");
}

function migrationsSql(): string {
  const dir = path.join(ROOT, "db/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => `-- ${f}\n${orderMigrationStatements(readFileSync(path.join(dir, f), "utf8"))}`)
    .join("\n");
}

export function buildSetupSql(): string {
  const rls = readFileSync(path.join(ROOT, "db/rls.sql"), "utf8");
  const booking = readFileSync(path.join(ROOT, "db/booking.sql"), "utf8");
  return `-- ════════════════════════════════════════════════════════════════════════════
-- DEMO DATABASE SETUP — generated by \`pnpm db:build-setup\`. DO NOT EDIT BY HAND
-- (except the two passwords below). ALL PATIENT DATA IN THIS FILE IS FAKE.
--
-- How to use (Supabase → SQL Editor → New query):
--   1. Paste this whole file.
--   2. Replace the two CHANGE_ME_... values in STEP 1 below with your own passwords.
--   3. Click "Run". Everything happens in one transaction: it either fully succeeds or
--      changes nothing. Safe to retry after fixing an error.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── STEP 1: YOUR PASSWORDS (edit the two values in quotes) ─────────────────
create temp table setup_params (
  app_db_password text,   -- password for the restricted "clinic_app" database login (goes into Vercel's DATABASE_URL)
  demo_password text,     -- password that every demo staff account uses to sign in to the app
  demo_password_hash text,
  -- the demo week is centred on today (Riyadh)
  demo_anchor date default (now() at time zone 'Asia/Riyadh')::date
) on commit drop;

insert into pg_temp.setup_params (app_db_password, demo_password) values (
  '${APP_PASSWORD_PLACEHOLDER}',
  '${DEMO_PASSWORD_PLACEHOLDER}'
);

-- ─── Safety checks ──────────────────────────────────────────────────────────
do $$
declare
  p record;
begin
  select * into p from pg_temp.setup_params;
  if p.app_db_password like 'CHANGE_ME%' or p.demo_password like 'CHANGE_ME%' then
    raise exception 'Please replace both CHANGE_ME_... passwords in STEP 1 before running.';
  end if;
  if length(p.app_db_password) < 16 then
    raise exception 'The clinic_app password must be at least 16 characters.';
  end if;
  if p.app_db_password !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Use only letters, numbers, - and _ in the clinic_app password (it goes inside a URL).';
  end if;
  if length(p.demo_password) < 10 then
    raise exception 'The demo staff password must be at least 10 characters.';
  end if;
  if to_regclass('public.tenants') is not null then
    raise exception 'The database is already set up (table "tenants" exists). To start over, run db/reset.sql first.';
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
update pg_temp.setup_params
  set demo_password_hash = extensions.crypt(demo_password, extensions.gen_salt('bf', 10));

-- ─── STEP 2: TABLES ─────────────────────────────────────────────────────────
${migrationsSql()}

-- ─── STEP 2b: BOOKING RULES (db/booking.sql) ────────────────────────────────
${booking}

-- ─── STEP 3: DEMO DATA (FAKE) ───────────────────────────────────────────────
${userInsert(`usr_${PLATFORM_OWNER.key}`, PLATFORM_OWNER.email, PLATFORM_OWNER.nameAr, PLATFORM_OWNER.nameEn, true)}
${SEED_TENANTS.map(tenantSql).join("\n")}

-- ─── STEP 3b: DEMO WEEK, PACKAGES, CONSENTS, NOTES (FAKE) ───────────────────
${demoSql()}

-- ─── STEP 4: RESTRICTED APP LOGIN (clinic_app) ──────────────────────────────
do $$
declare
  pw text := (select app_db_password from pg_temp.setup_params);
begin
  if not exists (select from pg_roles where rolname = 'clinic_app') then
    execute format('create role clinic_app login password %L nosuperuser nocreatedb nocreaterole nobypassrls noinherit', pw);
  else
    -- Supabase's postgres user is not a superuser, so it may only change the password here.
    execute format('alter role clinic_app login password %L', pw);
  end if;
  if exists (
    select from pg_roles where rolname = 'clinic_app'
      and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)
  ) then
    raise exception 'clinic_app has too many privileges (superuser/bypassrls/createrole/createdb). Stop and ask for help.';
  end if;
end $$;

-- ─── STEP 5: TENANT ISOLATION (db/rls.sql) ──────────────────────────────────
${rls}

commit;

select 'Setup complete. You can now add DATABASE_URL to Vercel.' as result;
`;
}
