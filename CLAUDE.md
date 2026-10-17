# CLAUDE.md — project rules

@AGENTS.md

## Product

Arabic-first SaaS for dermatology & aesthetic clinics in Saudi Arabia: booking, WhatsApp reminders,
patient records + e-consents, package/session balances, a WhatsApp AI receptionist, and a
draft-only AI scribe. Multi-tenant: many clinics, strictly separated.

**This is a DEMO. Fake patient data only. No real patient data, ever, in this phase.**

## Working rules

- The founder is non-technical: explain each step simply, show a plan before coding.
- Commit in small steps. Never continue while tests fail (`pnpm check` must pass before every commit).
- Never commit secrets. Real values live only in `.env.local` (git-ignored), Vercel and Supabase settings.
  Never ask for passwords/keys in chat.
- Do not swap any part of the stack without asking.

## Stack (fixed)

- Next.js (App Router, v16 — read `node_modules/next/dist/docs/` first) + TypeScript, pnpm
- Tailwind CSS v4 + shadcn/ui-style components (`src/components/ui`), lucide icons
- next-intl: Arabic default (RTL), English toggle (cookie `NEXT_LOCALE`, no locale in URL); font IBM Plex Sans Arabic
- PostgreSQL + Drizzle ORM (driver: `postgres`), Better Auth (self-hosted, email + password)
- Zod, React Hook Form, Vitest
- Hosting: Vercel (free) + Supabase **used only as plain Postgres** (no Supabase Auth/Storage/Realtime/SDK).
  Must stay portable to a Saudi-hosted Postgres later.

## Tenant isolation (never weaken)

- Every table except `tenants` and the auth tables (`users`, `sessions`, `accounts`, `verifications`)
  has `tenant_id`, plus composite foreign keys `(tenant_id, x_id)` so rows can't point at another clinic.
- Every tenant table has RLS **ENABLED + FORCED**; policy `tenant_id = app_current_tenant()`, which reads
  `current_setting('app.tenant_id')` and is NULL (→ zero rows) when unset. Fail closed.
- The app connects as role `clinic_app` (LOGIN, NOBYPASSRLS, not table owner). Never the admin user.
- All tenant data access goes through `withTenant(tenantId, fn)` (`src/db/tenant.ts`), which uses
  a transaction-local setting — safe with Supabase's transaction pooler (port 6543, `prepare: false`).
- The clinic comes from the subdomain (`derma.localhost`); hosts outside `APP_ROOT_DOMAIN`
  (e.g. `*.vercel.app`) fall back to `DEMO_DEFAULT_CLINIC`.
- Next.js Cache Components stay OFF: no cross-request caching of clinic data.
- Platform owners have NO backdoor to patient data.

## Roles

`platform_owner` (on `users`), and per clinic in `tenant_members`: `clinic_admin`, `practitioner`,
`receptionist`. Permissions live in `src/lib/auth/permissions.ts`; pages call `requirePermission()`.
Receptionists can never see clinical notes. A member can hold several roles (`tenant_members.roles`, at least one);
any role that allows something grants it. Clinical notes need the `practitioner` role (admins alone are blocked).

## Database changes

- Edit `src/db/schema.ts` → `pnpm db:generate` (Drizzle SQL) → `pnpm db:build-setup` regenerates
  `db/setup.sql` (schema + seed + RLS + roles in one transaction). A test fails if it is stale.
- Supabase is set up by pasting `db/setup.sql` into the Supabase SQL Editor (no admin password leaves Supabase).
  Later phases add numbered `db/upgrades/NNNN_*.sql` files to paste in order. Founder guide: `docs/DEPLOY.md`.
- Supabase's `postgres` user is NOT a superuser. SQL we ship must work without superuser rights
  (e.g. never `ALTER ROLE ... NOBYPASSRLS`, never `DROP OWNED BY clinic_app`). Local databases are
  built by the non-superuser `local_admin` to catch this.
- Hosting: Vercel functions run in `bom1` (Mumbai, `vercel.json`) next to the database.
  Use Supabase's **transaction pooler** (port 6543) with user `clinic_app.<project-ref>`.
- Every change to records must call `audit()` (`src/lib/audit.ts`).

## Commands

- `pnpm db:local` — rebuild local database `derma_dev` from `db/setup.sql`
- `pnpm dev` — then open http://derma.localhost:3000
- `pnpm check` — lint, format, typecheck, tests (tests build a fresh `derma_test` DB from `db/setup.sql`;
  local Postgres must be running: `service postgresql start`)
- `pnpm e2e` — browser tests per role against a running `pnpm dev`
  (in the cloud workspace: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`)
