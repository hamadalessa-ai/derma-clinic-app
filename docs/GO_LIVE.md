# Going live — founder guide

The app runs as **two separate systems** from the same code:

|          | Demo (today)                                      | Live (real clinics)                                                              |
| -------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Database | Supabase project "demo"                           | a NEW Supabase project, Pro plan                                                 |
| Website  | Vercel project "derma-clinic-app" (branch `main`) | a NEW Vercel project (branch `live`)                                             |
| Data     | fake, rebuilt from scratch on every update        | real, **never reset**, only upgraded                                             |
| Updates  | automatic after every merge                       | when you press **Release to live**                                               |
| Backups  | none needed                                       | Supabase daily + our own nightly encrypted copy (30 days) + monthly restore test |

Nothing here needs a terminal. You click buttons in GitHub, Supabase and Vercel, and paste values
into their **settings** pages, never into a chat.

Keep every password and key below in a password manager (1Password, Bitwarden, Apple Passwords).

---

## Step 1 — Make the GitHub repository private (before any real data)

GitHub → the repository → **Settings → General → Danger zone → Change visibility → Private**.

Why: workflow logs and backup files of a public repository can be seen by anyone. The backups are
encrypted, but a private repository is the safe default for a medical product.

Private repositories get 2,000 free workflow minutes a month; the tests use more than that, so
set a spending limit under **GitHub → Settings → Billing → Budgets** (about $5–15 a month), or
upgrade to GitHub Team.

## Step 2 — Create the live Supabase project

1. Supabase → **New project**. Name: `clinic-live`. Region: **South Asia (Mumbai)** (next to the
   website servers). Create a strong database password and save it.
2. Upgrade the organisation to **Pro** (daily backups kept 7 days, no pausing).
3. Wait until the project is ready. Do **not** run any SQL yet.

## Step 3 — Add the live secrets to GitHub

GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Name                   | Value                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_ADMIN_URL`       | live project → **Connect** → "Session pooler" string (user `postgres.<ref>`, port 5432), with the database password from step 2 filled in |
| `LIVE_APP_DB_PASSWORD` | a NEW random password, 24+ characters, only letters, numbers, `-` and `_`                                                                 |
| `LIVE_OWNER_EMAIL`     | the email you will sign in with                                                                                                           |
| `LIVE_OWNER_PASSWORD`  | your first password, 14+ characters (you change it after signing in)                                                                      |
| `BACKUP_PASSPHRASE`    | a NEW long passphrase (5–6 random words). **Write it down on paper too:** without it the backups can't be opened, by anyone, ever         |

## Step 4 — Build the live database (once)

GitHub → **Actions → Set up live database → Run workflow**, type `SET UP LIVE`, run.

It builds every table and security rule, with **no demo clinics and no patients**, plus your
platform-owner login. It refuses if the database isn't empty, so it can't damage anything.

## Step 5 — The backup login

Supabase (live project) → **SQL Editor → New query**, paste, put a NEW password in the quotes, run:

```sql
create role backup_reader login password 'PUT-A-NEW-LONG-PASSWORD-HERE' bypassrls;
grant pg_read_all_data to backup_reader;
grant usage on schema ops to backup_reader;
grant insert on ops.backup_runs to backup_reader;
```

This login can read everything (to copy it) and write only one thing: the "backup done" record.

Add the GitHub secret `LIVE_BACKUP_URL`: the same Session pooler string as `LIVE_ADMIN_URL`, but
with user `backup_reader.<ref>` and the password you just chose.

Then: **Actions → Backup live database → Run workflow**, and after it is green,
**Actions → Restore test → Run workflow**. Both green = backups work end to end.

From now on the backup runs every night at 01:00 Riyadh time and the restore test on the 1st of
every month. If either fails, GitHub emails you.

## Step 6 — The live website (Vercel)

1. Vercel → **Add New → Project** → import the same GitHub repository. Name: `clinic-live`.
2. **Settings → Git → Production Branch**: `live`.
3. **Settings → Environment Variables** (Production). Make NEW values for every secret; never
   reuse the demo's:

| Name                                                                               | Value                                                                                                                   |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                     | live project → Connect → **Transaction pooler** (port 6543), user `clinic_app.<ref>`, password = `LIVE_APP_DB_PASSWORD` |
| `BETTER_AUTH_SECRET`                                                               | new random 32+ characters                                                                                               |
| `DATA_ENCRYPTION_KEY`                                                              | new random 32+ characters (encrypts each clinic's WhatsApp token; never change it later)                                |
| `VERIFICATION_SECRET`                                                              | new random 32+ characters                                                                                               |
| `CRON_SECRET`                                                                      | new random 32+ characters                                                                                               |
| `APP_ROOT_DOMAIN`                                                                  | your domain, e.g. `yourbrand.sa`                                                                                        |
| `APP_PUBLIC_URL`                                                                   | `https://yourbrand.sa`                                                                                                  |
| WhatsApp, `ANTHROPIC_API_KEY`, `DAILY_API_KEY`, `VAPID_*`, `OPS_ALERT_WEBHOOK_URL` | as in DEPLOY.md, when you turn those features on                                                                        |

Do **not** set `MESSAGE_DEMO_MODE` on the live project.

4. **Settings → Domains**: add `yourbrand.sa` and `*.yourbrand.sa` (each clinic gets
   `clinicname.yourbrand.sa`). Vercel shows the DNS records to add at your domain registrar.
5. Upgrade the live Vercel project to **Pro** (commercial use is not allowed on the free plan).
6. GitHub secrets for hourly WhatsApp reminders: `LIVE_APP_URL` (`https://yourbrand.sa`) and
   `LIVE_CRON_SECRET` (the same `CRON_SECRET` as above).

## Step 7 — First release

GitHub → **Actions → Release to live → Run workflow** (branch `main`), type `RELEASE`, and
switch off "Rehearse" this first time only (there is no backup yet to rehearse on). It creates
the `live` branch and Vercel deploys it.

## Step 8 — Uptime alerts

[UptimeRobot](https://uptimerobot.com) (free) → **New monitor → HTTP(s)** →
`https://yourbrand.sa/api/health`, every 5 minutes, alert to your email/WhatsApp.
The page answers "ok" when the website and the database both work, and shows no clinic data.

## Step 9 — Check and open

1. Sign in at `https://yourbrand.sa/login` with `LIVE_OWNER_EMAIL`, then change your password.
2. **Platform → System status**: everything green, except optional features you haven't
   turned on yet.
3. **Platform → New clinic**, with "demo clinic" **switched off**. Invite the clinic admin.

---

## Every release after that

1. Changes are merged into `main` as today → the demo updates by itself; try them there.
2. When you're happy: **Actions → Release to live → Run workflow**, type `RELEASE`.
   - It first restores last night's backup on GitHub and runs the database update on that copy.
   - Only if that works does it update the live database (all or nothing), then the website.
   - If anything fails, you get an email and the live system stays as it was.

## If something goes wrong

| Problem                          | What to do                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website down (UptimeRobot alert) | Vercel → live project → Deployments → the previous green one → **Instant Rollback**                                                                                    |
| A bad release                    | Same rollback for the website. Database changes only ever _add_, so the old website still works with it                                                                |
| Data lost or damaged             | Supabase → live project → **Database → Backups** → restore a day (Pro keeps 7 days). Older than that: our nightly copies (30 days) — ask for help, the steps are below |
| Backup or restore test failed    | Open the failed run in GitHub Actions; usually a changed password in `LIVE_BACKUP_URL`                                                                                 |

### Restoring one of our own nightly copies (technical, for whoever helps you)

1. GitHub → Actions → Backup live database → the run → download the `live-backup` artifact.
2. `gpg --decrypt live-<date>.tar.gpg > live.tar && tar -xf live.tar` (asks for `BACKUP_PASSPHRASE`).
3. Into a NEW empty Supabase project:
   `pg_restore --no-owner --no-privileges --dbname "<session pooler URL>" live.dump`
   (`scripts/backup/verify-restore.sh` shows the exact preparation and checks).
4. Create the `clinic_app` login there (the role block in `buildLiveSetupSql`, `src/db/setup-sql.ts`),
   then run **Release to live** against it (set `LIVE_ADMIN_URL` to the new project): it re-applies all
   security rules and the `clinic_app` permissions. Then point Vercel's `DATABASE_URL` at it.

## What it costs (monthly, approximate)

Supabase Pro $25 · Vercel Pro $20 · GitHub minutes $0–15 · UptimeRobot free · domain ~$15/year.
WhatsApp, AI and video are pay-per-use.
