# Launch checklist (QA + DevOps)

Two lists: what to test before any clinic uses the app, and what must be in place to launch.
Automated tests (GitHub "Tests") already cover most rules below; the manual list is what a person
checks on real phones before a demo or a pilot.

## A. Edge cases to test (manual, on a phone and a tablet)

### Booking and the calendar

- [ ] Two people book the SAME doctor and time at the same moment (two phones) → one succeeds, the other sees "This time was just booked".
- [ ] A laser booking when the only laser device is busy → the time is not offered.
- [ ] Booking across a break (13:45 for a 30-minute service with a 14:00 break) → refused "during break".
- [ ] A doctor with two shifts (e.g. 09:00–12:00 and 17:00–21:00) → no times offered between shifts; 17:00 is offered.
- [ ] A one-off day off for a doctor who already has bookings → the bookings are listed as conflicts; none are moved or cancelled.
- [ ] An extra Friday clinic (special hours) → Friday becomes bookable online for that doctor only.
- [ ] A clinic holiday → greyed out on the booking page; reception can't book it either.
- [ ] Online booking less than 2 hours ahead / more than 30 days ahead → not offered.
- [ ] Online booking with "approval required" on → appointment is "pending" and appears in Inbox → Requests.
- [ ] Riyadh time: a booking at 23:30 Riyadh shows on the right day for staff and patient (never UTC's day).

### Check-in, packages and consents

- [ ] Check-in with an unsigned consent → the signature sheet opens; signing finishes the check-in.
- [ ] Tapping Check in twice quickly (or two receptionists) → one session deducted, never two.
- [ ] Package expired or used up → no deduction, check-in still works, shows "no package".
- [ ] Consent rule "once per package": second visit of the same package doesn't ask again; a new package does.
- [ ] Consent text edited by the admin → next visit asks for a new signature (old signatures keep the old text).
- [ ] WhatsApp consent link opened twice → second time says "nothing to sign".
- [ ] Consent link for a cancelled visit → "this link has closed".
- [ ] Child's file (guardian) → consent link says "signing as guardian"; record shows relation guardian.

### Doctor's visit and notes

- [ ] Start visit → status "with the doctor"; the note opens with the AI scribe.
- [ ] Sign & complete with an empty note → refused; nothing changes.
- [ ] Sign & complete → note signed AND visit completed; back on My Day.
- [ ] A signed note can't be edited; an addendum can be added.
- [ ] Reception and admins (without the doctor role) can never open notes (page or URL).
- [ ] AI scribe with the clinic switch off / no API key → the box doesn't appear; nothing breaks.
- [ ] AI scribe fails (no internet) → the spoken text stays in the box; the note is unchanged.

### Video consultations

- [ ] Join link before the time → "opens 15 minutes before"; page opens by itself when it's time.
- [ ] Patient joins without the telehealth consent → asked to sign first (via the consent link).
- [ ] Patient joins → appointment becomes "arrived" automatically (once).
- [ ] Another doctor opens the visit URL → forbidden.
- [ ] Join link edited by hand (one character changed) → "not found".
- [ ] Video key missing → "video isn't connected yet", everything else works.
- [ ] Phone camera/microphone permission denied → clear message; allowing it and re-joining works.

### WhatsApp and the AI receptionist

- [ ] Patient replies "yes" twice → booked once (confirmation only after a newer message).
- [ ] Medical worry ("redness after laser") → handed to staff, never advice; 997 only for emergency signs.
- [ ] Staff replies in a chat → the AI stops answering that chat until "Let AI answer" again.
- [ ] Patient sends STOP → no more reminders; START → resumes.
- [ ] Daily AI limit reached → messages go to the inbox as normal.
- [ ] The same reminder job runs twice (cron retry) → each message sent once.

### Separation and privacy

- [ ] Lamsa staff can never see Derma's data (any page, any URL, any search).
- [ ] Platform owner sees no patient data.
- [ ] A receptionist restricted to Riyadh never sees Jeddah appointments.
- [ ] Patient page shows only the patient's own and their children's visits.
- [ ] Lock-screen notifications show initials + service + time only.

### Phones, languages, accessibility

- [ ] Every main screen at 360px wide: no sideways scrolling, bottom bar never covers buttons.
- [ ] Arabic (RTL) and English (LTR): times, phone and file numbers stay left-to-right in Arabic text.
- [ ] Keyboard only (laptop): every button reachable, focus ring visible.
- [ ] Slow 3G: pages show loading skeletons, buttons show "Saving…", no double submissions.

## B. Deployment checklist

### Accounts and settings (one-time)

- [ ] Vercel project: production branch `main`; region `bom1` (or the Saudi host later).
- [ ] Environment variables in Vercel (Production):
  - `DATABASE_URL` (transaction pooler, port 6543, user `clinic_app.<project-ref>`, `prepare: false`)
  - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_PUBLIC_URL`, `APP_ROOT_DOMAIN`, `DEMO_DEFAULT_CLINIC`
  - `VERIFICATION_SECRET` (signs codes, WhatsApp buttons, video and consent links — 32+ random characters; changing it invalidates links already sent)
  - `MESSAGE_DEMO_MODE` (`on` for the demo; **off** for real clinics)
  - `ANTHROPIC_API_KEY` (AI receptionist + scribe; note its expiry date)
  - `DAILY_API_KEY` (video), optional `DAILY_GEO`
  - `CRON_SECRET` (daily cron route), push keys (VAPID) if phone notifications are on
  - WhatsApp (when Meta is verified): `WHATSAPP_*` per docs/DEPLOY.md Part F
- [ ] GitHub secrets for workflows: `SUPABASE_ADMIN_URL`, `APP_DB_PASSWORD`, `DEMO_STAFF_PASSWORD`.
- [ ] Spending alerts: Anthropic console, Daily billing, Vercel, Supabase.

### Database

- [ ] Demo: merges that change `db/setup.sql` reset the demo database automatically (Part G).
- [ ] **Before the first real clinic:** switch OFF the automatic reset; from then on only numbered `db/upgrades/NNNN_*.sql` files that keep data, applied in one transaction, tested on a copy first.
- [ ] Daily backups switched on (Supabase PITR or the Saudi host's equivalent); a restore tested once.
- [ ] The app connects as `clinic_app` only (never the admin user); RLS forced on every clinic table (tests check this).

### Before real patients (not technical, but blocking)

- [ ] Commercial Registration → Meta business verification → real WhatsApp number and approved templates.
- [ ] Saudi hosting for patient data (database, files, video) per PDPL; data-processing agreements with Anthropic and the video provider, or Saudi-hosted alternatives.
- [ ] Legal review: privacy notice, consent wording (incl. telehealth and AI scribe), record retention.
- [ ] Clinic's MOH telemedicine registration (for video consultations).
- [ ] Vercel paid plan (or Saudi host) — the free plan is for demos only.
- [ ] `MESSAGE_DEMO_MODE` off, demo banner off, demo clinics removed from the real database.

### Release routine (every change)

1. Pull request → GitHub "Tests" green (lint, format, types and all tests on a fresh database).
2. Merge → Vercel deploys (check the deployment is "Ready"); database workflow runs if SQL changed.
3. Smoke test on a phone: sign in as reception and as a doctor, book, check in, start visit, sign.
4. If something breaks: Vercel → Deployments → previous → "Promote to production" (instant rollback).
