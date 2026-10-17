/**
 * Builds db/setup.sql: ONE file that creates the whole demo database in a single transaction.
 * It is pasted into the Supabase SQL Editor, so the admin password never leaves Supabase.
 *
 * Order matters: tables → demo data → app role + RLS. Data is inserted before FORCE RLS
 * is switched on; afterwards only clinic_app (inside withTenant) can touch clinic rows.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  demoId,
  PLATFORM_OWNER,
  SEED_TENANTS,
  WORK_HOURS,
  WORK_WEEK,
  type SeedTenant,
} from "./seed-data";

export const APP_PASSWORD_PLACEHOLDER = "CHANGE_ME_APP_DB_PASSWORD";
export const DEMO_PASSWORD_PLACEHOLDER = "CHANGE_ME_DEMO_PASSWORD";

const ROOT = path.resolve(__dirname, "../..");

function lit(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function insert(table: string, rows: Record<string, string | number | boolean | null>[]) {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const values = rows.map((r) => `  (${cols.map((c) => lit(r[c])).join(", ")})`).join(",\n");
  return `insert into public.${table} (${cols.join(", ")}) values\n${values};\n`;
}

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
      { id: tid, slug: t.slug, name_ar: t.nameAr, name_en: t.nameEn, brand_color: t.brandColor },
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
        role: s.role,
        branch_id: s.branch ? ref("branch", s.branch) : null,
        title_ar: s.titleAr,
        title_en: s.titleEn,
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
        is_demo_value: true,
        sort_order: i,
      })),
    ),
  );
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
        is_fake: true,
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

function migrationsSql(): string {
  const dir = path.join(ROOT, "db/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map(
      (f) =>
        `-- ${f}\n${readFileSync(path.join(dir, f), "utf8").replaceAll("--> statement-breakpoint", "")}`,
    )
    .join("\n");
}

export function buildSetupSql(): string {
  const rls = readFileSync(path.join(ROOT, "db/rls.sql"), "utf8");
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
  demo_password_hash text
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

-- ─── STEP 3: DEMO DATA (FAKE) ───────────────────────────────────────────────
${userInsert(`usr_${PLATFORM_OWNER.key}`, PLATFORM_OWNER.email, PLATFORM_OWNER.nameAr, PLATFORM_OWNER.nameEn, true)}
${SEED_TENANTS.map(tenantSql).join("\n")}

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
