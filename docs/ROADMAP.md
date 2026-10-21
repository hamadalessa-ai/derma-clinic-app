# Roadmap

All phases use **fake demo data only** until a compliance review (PDPL / NCA / SFDA / MOH) is done
and the database moves to Saudi-hosted Postgres.

## Phase 0 — Foundation ✅

- Next.js + TypeScript scaffold, lint/format/tests
- Arabic-first UI (RTL) with English toggle; Hijri + Gregorian dates; SAR currency
- Database schema: clinics, branches, departments, staff, rooms, devices, services, schedules, patients, audit log
- Strict clinic separation with Postgres Row-Level Security + restricted app role
- Staff login and roles (platform owner, clinic admin, practitioner, receptionist)
- Seeded demo clinics: Derma Clinics (Riyadh + Jeddah) and Lamsa Clinic
- Minimal UI: login, dashboard shell, branch switcher, Patients and Services lists
- Deploy on Vercel + Supabase

## Phase 1 — Core clinic workflow ✅ (current)

- Booking engine: doctor + room + device, duration and buffer, working hours, breaks, holidays, blocked time;
  double-booking refused by the database; statuses with audit trail
- Reception calendar: day view per doctor / per room, week view per doctor, book / move / cancel,
  next free slot, near-real-time updates (polling)
- Doctor "My Day" (phone-first, installable): confirm, start, complete, block own time; reschedule directly
  or by request depending on the clinic setting
- Patient profile: demographics, fake ID/Iqama, medical alerts everywhere, family/guardian, visits,
  packages, consents, notes; Arabic-aware search
- Consents: versioned templates (AR/EN), signature pad, official signed record in the database,
  browser print view and Arabic-safe PDF; FileStore (Postgres now, S3-compatible later)
- Packages: templates, selling, payments (paid / partial / outstanding), idempotent check-in deduction,
  audited overrides
- Check-in flow: consent → deduction → arrived → visible on My Day
- Clinical notes: draft → signed → addenda, practitioners only (database-enforced)
- Central theme tokens + shared components (ready for the redesign)

## Phase 2 — Notifications & AI scribe (proposed)

- Push notifications to doctors' phones (service worker is ready), e.g. "patient arrived"
- WhatsApp reminders and confirmations (Business API, Arabic templates), no-show follow-up
- AI scribe: **draft-only** notes from dictation into the existing draft → sign flow; practitioner must review
- Before/after photos via the FileStore

## Phase 3 — AI receptionist, reporting & Saudi hosting (proposed)

- WhatsApp AI receptionist: FAQs, proposes free slots from the booking engine, books with staff approval
- Online booking link per clinic
- Reports: revenue, utilisation per room/device, package liabilities
- Move to Saudi-hosted Postgres and S3-compatible storage; security review; pilot with a real clinic
