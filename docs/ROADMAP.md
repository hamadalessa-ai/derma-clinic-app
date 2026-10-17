# Roadmap

All phases use **fake demo data only** until a compliance review (PDPL / NCA / SFDA / MOH) is done
and the database moves to Saudi-hosted Postgres.

## Phase 0 — Foundation (current)

- Next.js + TypeScript scaffold, lint/format/tests
- Arabic-first UI (RTL) with English toggle; Hijri + Gregorian dates; SAR currency
- Database schema: clinics, branches, departments, staff, rooms, devices, services, schedules, patients, audit log
- Strict clinic separation with Postgres Row-Level Security + restricted app role
- Staff login and roles (platform owner, clinic admin, practitioner, receptionist)
- Seeded demo clinics: Derma Clinics (Riyadh + Jeddah) and Lamsa Clinic
- Minimal UI: login, dashboard shell, branch switcher, Patients and Services lists
- Deploy on Vercel + Supabase

## Phase 1 — Booking & reminders

- Appointment calendar per branch / practitioner / room, respecting service duration, buffer and required device
- Online booking link per clinic; reschedule / cancel
- WhatsApp reminders (Business API) with Arabic templates; confirmations and no-show tracking
- Patient create/edit with audit trail

## Phase 2 — Records, consents & packages

- Patient profile, visit history, clinical notes (practitioners only), photos (before/after)
- E-consent forms in Arabic/English with signature capture and versioning
- Packages and session balances (e.g. 6 laser sessions), payments in SAR, VAT invoices (ZATCA-ready)
- Reports: revenue, utilisation per room/device

## Phase 3 — AI assistants

- WhatsApp AI receptionist: answers FAQs, proposes slots, books with staff approval; hand-off to humans
- AI scribe: **draft-only** visit notes from practitioner dictation; practitioner must review and sign
- Guardrails: no diagnosis to patients, full audit logging, data stays in-region
- Move to Saudi-hosted Postgres; security review; pilot with a real clinic
