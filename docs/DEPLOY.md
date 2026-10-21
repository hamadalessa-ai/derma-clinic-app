# Putting the demo online (Supabase + Vercel)

No installing and no terminal: everything happens in your browser. It takes about 20 minutes.
Secrets go **only** into Supabase and Vercel settings. Never paste them into a chat, email or GitHub.

You will create two passwords. Keep both in your password manager:

| Password                  | What it's for                                                          | Rules                                                                               |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **App database password** | The restricted `clinic_app` login the app uses to talk to the database | At least 16 characters, **only letters and numbers** (it goes inside a web address) |
| **Demo staff password**   | What you type on the login page for every demo account                 | At least 10 characters                                                              |

Tip for the app database password: open <https://generate-secret.vercel.app/32>. It gives a
random 32-character string of letters and numbers. Copy it into your password manager.
(Or use your password manager's generator with symbols switched off.)

---

## Part A — Create the database (Supabase)

1. Open the file **`db/setup.sql`** on GitHub (repository `derma-clinic-app` → folder `db` → `setup.sql`).
   Click the **Copy raw file** button (two overlapping squares, top-right of the file).
2. In Supabase, open your project → left menu **SQL Editor** → **+ New query**.
3. Paste the whole file.
4. Near the top, find **STEP 1** and replace the two values inside the quotes:
   - `CHANGE_ME_APP_DB_PASSWORD` → your **app database password**
   - `CHANGE_ME_DEMO_PASSWORD` → your **demo staff password**

   Keep the single quotes around each password, e.g. `'a1b2c3...'`.

5. Click **Run** (bottom-right). Expected result: a single row saying
   _"Setup complete. You can now add DATABASE_URL to Vercel."_
6. **Close this query tab without saving it**, because it now contains your passwords.
   (If Supabase saved it automatically, delete it under _SQL Editor → Private_.)

If you see an error instead:

- _"Please replace both CHANGE_ME\_..."_ → you missed step 4.
- _"The database is already set up"_ → it already worked earlier. To start over, paste and run
  `db/reset.sql` first, then do Part A again.
- Anything else: nothing was changed (it all runs as one unit). Copy the error text (it has no
  secrets) and send it to me.

### Get the connection address

7. In Supabase click **Connect** (top of the page) → **Connection String** → choose
   **Transaction pooler** (this is the type that works best with Vercel). Copy the address. It looks like:

   `postgresql://postgres.wmrgcidygdkcmhurfxtv:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`

8. Edit it in a notes app or your password manager (**not** in a chat):
   - change `postgres.` at the start to **`clinic_app.`**
   - replace `[YOUR-PASSWORD]` (including the square brackets) with your **app database password**

   Result: `postgresql://clinic_app.wmrgcidygdkcmhurfxtv:YOURPASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`

   This is your **DATABASE_URL**. Keep the port `6543` and the host exactly as Supabase gave them.

> Why `clinic_app` and not `postgres`? `postgres` is the master key that ignores the clinic walls.
> `clinic_app` can only ever see one clinic at a time. The app refuses to start with `postgres`.

---

## Part B — Put the app online (Vercel, free plan)

1. Go to <https://vercel.com/signup> → **Hobby** (free) → **Continue with GitHub**.
2. Click **Add New… → Project**. Find `derma-clinic-app` and click **Import**.
   If it's not in the list, click **Adjust GitHub App Permissions** and allow that repository.
3. Leave _Framework_ (Next.js), _Root Directory_ and _Build settings_ as they are.
4. Open **Environment Variables** and add these three (name on the left, value on the right):

   | Name                  | Value                                                                                            |
   | --------------------- | ------------------------------------------------------------------------------------------------ |
   | `DATABASE_URL`        | the address from Part A, step 8                                                                  |
   | `BETTER_AUTH_SECRET`  | a **new** random string from <https://generate-secret.vercel.app/32> (not the database password) |
   | `DEMO_DEFAULT_CLINIC` | `derma`                                                                                          |

5. Click **Deploy**. After 1–2 minutes you get a link like `https://derma-clinic-app.vercel.app`.
6. Open it on your phone and laptop. Sign in with a demo account shown on the login page
   (e.g. `admin@derma.demo`) and your **demo staff password**.

The app runs in Vercel's Mumbai region (set in `vercel.json`), next to your Mumbai database, so pages load quickly.

### Later updates

Every time new work is merged into the `main` branch on GitHub, Vercel updates the site automatically.
While we only have fake demo data, a phase that changes the database is installed by **resetting the demo
data** (Part C below). Once real clinics use the system, we'll switch to numbered `db/upgrades/…sql` files
that keep existing data.

### Changing a secret

Vercel → your project → **Settings → Environment Variables** → edit → then **Deployments** →
the latest one → **⋯ → Redeploy**. Changes only apply after a redeploy.

---

## Part C — Updating the live demo to Phase 1

The live database has Phase 0 tables. Phase 1 adds many new ones, so we **reset the demo data and set it
up again** (everything is fake, nothing real is lost). About 5 minutes, all in the browser.
**Nothing changes in Vercel** if you reuse your app database password.

Do it **right after merging** the Phase 1 pull request (Vercel publishes the new app within ~2 minutes;
until the database is updated, the live link shows errors).

1. On GitHub, merge the Phase 1 pull request (**Merge pull request → Confirm merge**).
2. Supabase → **SQL Editor** → **+ New query**. Open **`db/reset.sql`** on GitHub (branch `main`), click
   **Copy raw file**, paste, and click **Run**. Supabase warns that the query is destructive — confirm.
   Expected: _"Reset complete. Now run db/setup.sql."_
3. **+ New query** again. Copy **`db/setup.sql`** from GitHub (`main`), paste, and in **STEP 1** put:
   - `CHANGE_ME_APP_DB_PASSWORD` → the **same app database password as last time** (the one inside your
     Vercel `DATABASE_URL`). Then Vercel needs no change.
   - `CHANGE_ME_DEMO_PASSWORD` → your demo staff password (same or new).

   Click **Run**. Expected: _"Setup complete. You can now add DATABASE_URL to Vercel."_

4. Close both query tabs **without saving** (the second contains passwords).
5. Open the Vercel link and sign in. Done.

**Lost the app database password?** In step 3 choose a new one, then in Vercel → Settings → Environment
Variables edit `DATABASE_URL` (replace the password part), and **Redeploy** (Deployments → latest → ⋯ → Redeploy).

**Before showing the demo on another day:** sign in as `admin@derma.demo` → **Settings** → **Refresh demo
week**. The demo appointments move so they surround today again (your test bookings are cancelled).
On a Friday (clinic closed) "today" becomes Saturday.

### Try the full workflow (about 5 minutes)

Use two devices: your laptop for **reception**, your phone for **Dr. Sara**.

1. **Laptop:** sign in as `reception.riyadh1@derma.demo` → **التقويم** (Calendar) → **حجز جديد** (New booking). Search
   `D-0016`, choose **التقشير الكيميائي** (Chemical Peeling), doctor **د. سارة العتيبي**, press **أقرب موعد متاح**
   (Next free slot), tap a time, **احجز** (Book). (To see a package balance drop, first open the patient → **Packages** → sell the
   _Chemical Peeling — 4 sessions_ package.)
2. **Phone:** sign in as `dr.sara@derma.demo` → **My Day**: the new patient appears (use the arrows if the
   slot is another day). Tip: browser menu → **Add to Home screen** installs it like an app.
3. **Laptop:** tap the appointment → **Check in** → the consent form opens → the patient signs on the
   screen → **Confirm signature**. You see "one session deducted — 3 of 4 left" and the status becomes
   **Arrived**.
4. **Phone:** My Day updates by itself within ~15 seconds → **Start** → **Visit note** → **New note** →
   write → **Sign note**.
5. Patient profile → **Consents** → **Print view** (perfect Arabic, "Print / Save as PDF") or **Download PDF**.

Ready-made story for today: **D-0002** has a laser hair-removal package (3 of 6 used) and is booked with
Dr. Sara at 17:00 without a signed laser consent — check her in to see the consent + deduction straight away.

---

## Part D — Updating the live demo to Phase 2a (online booking, patient page, phone notifications)

About 15 minutes, all in the browser. Everything is fake demo data, so we **reset and set up again** like Part C.

### D1. Merge and reset the database (5 minutes)

1. On GitHub, merge the Phase 2a pull request (**Merge pull request → Confirm merge**).
2. Supabase → **SQL Editor** → **+ New query** → paste **`db/reset.sql`** (from `main`) → **Run** → confirm.
   Expected: _"Reset complete. Now run db/setup.sql."_
3. **+ New query** → paste **`db/setup.sql`** (from `main`). In **STEP 1** put the **same app database password
   as before** and your demo staff password → **Run**. Expected: _"Setup complete…"_
4. Close both tabs **without saving**.

### D2. New Vercel settings (5 minutes)

Vercel → your project → **Settings → Environment Variables** → add:

| Name                | Value                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `MESSAGE_DEMO_MODE` | `on` — codes are shown on screen instead of being sent (only for demo clinics; no messages are sent)  |
| `CRON_SECRET`       | a **new** random string from <https://generate-secret.vercel.app/32> (protects the daily cleanup job) |

Then the **phone notification keys** (no terminal, nothing pasted in a chat):

1. Open the live link, sign in as `owner@platform.demo` → **Platform** → **Push notification keys** →
   **Create new keys**. The keys are made inside your browser; the private key is never sent anywhere.
2. Copy each of the three values into Vercel as a new variable: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   and `VAPID_SUBJECT` (write your email as `mailto:you@example.com`).
3. **Deployments** → the latest one → **⋯ → Redeploy**. Settings only apply after a redeploy.
4. Back on the **Push notification keys** page you should now see _"Push keys are set on the server ✓"_.

The daily cleanup job (`/api/cron/daily`) is registered by `vercel.json` and runs once a day (the free plan
allows one run per day). You can see it under Vercel → your project → **Settings → Cron Jobs**.

> Changing the VAPID keys later disconnects all registered phones; everyone then taps "Turn on" again.

### D3. Install the app on Dr. Sara's phone and turn on notifications (3 minutes)

- **iPhone:** open the link in **Safari** → Share button → **Add to Home Screen** → **Add**. Open the app
  **from the Home Screen icon** (notifications only work there) → sign in as `dr.sara@derma.demo` →
  **My account** (in "More") → **Turn on for this device** → **Allow**. Then **Send a test notification**.
- **Android:** open the link in Chrome → sign in → **My account** → **Turn on for this device** → **Allow**.

The lock screen only shows the patient's **initials**, the **service** and the **time**: never the name,
phone number or anything medical. Each person can switch types off under "What do you want to get?".

### D4. Try it (the "done when" check)

1. **Your phone (as a patient):** open `…vercel.app/book`. You see the blue _"Demo mode"_ label.
   Choose **Riyadh** → **Botox** → **Dr. Sarah Al-Otaibi** (or "Female doctor") → a day → a time →
   your name, a fake mobile like `0598000123` → **Send verification code** → the code appears on screen →
   type it → **Confirm booking**.
2. **Dr. Sara's phone** gets a notification: _"New booking · ع. س. · بوتوكس · 25/10 11:00"_.
3. **Laptop (reception):** `reception.riyadh1@derma.demo` → **Calendar** → that day: the booking has the
   🌐 **Online** badge.
4. **Your phone:** tap **Open my page** (or open `/my` and sign in with the same mobile + a new code). You see
   the appointment and _"Consents needed before your visit"_ → **Sign now** → sign with your finger → tick
   "I have read…" → **Confirm signature**.
5. **Laptop:** open the appointment → it says _"Consent already signed on the patient page ✓"_ → **Check in**
   goes straight through (no consent screen).

Ready-made: patient **D-0007** (mobile `0500010007`) has an online Botox booking and an unsigned consent;
**D-0012** has an online consultation today with Dr. Sara.

### Online booking settings

Sign in as `admin@derma.demo` → **Settings** → **Online booking**: the booking link with **Copy** and
**Download QR code** (print it for reception), on/off, how far ahead, minimum notice, cancellation window,
"needs approval" (bookings then wait under **Requests** for Approve / Reject) and "show prices".
Below: which services are bookable online, and each doctor's gender (for "female / male doctor").

**Safety rule:** codes are shown on screen only when the clinic is a demo clinic **and** `MESSAGE_DEMO_MODE=on`.
A real clinic never shows codes; without a real WhatsApp/SMS sender (Phase 2b) its booking page says it
can't send a code and asks the patient to contact the clinic.

---

## Demo accounts (Derma Clinics)

All use your demo staff password.

| Role                               | Email                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| Clinic admin (both branches)       | `admin@derma.demo`                                                 |
| Doctors, Riyadh                    | `dr.sara@derma.demo`, `dr.faisal@derma.demo`, `dr.reem@derma.demo` |
| Doctors, Jeddah                    | `dr.lina@derma.demo`, `dr.majed@derma.demo`                        |
| Receptionists, Riyadh              | `reception.riyadh1@derma.demo`, `reception.riyadh2@derma.demo`     |
| Receptionist, Jeddah               | `reception.jeddah@derma.demo`                                      |
| Platform owner (no patient access) | `owner@platform.demo`                                              |

Lamsa Clinic (`admin@lamsa.demo`, `dr.mona@lamsa.demo`, `reception@lamsa.demo`) exists to prove
separation. On the Vercel link, Lamsa accounts are refused, because that link is Derma's. Lamsa gets its own
address once we connect a custom domain (e.g. `lamsa.yourdomain.sa`).

**Remember:** anyone who has the link _and_ the demo password can sign in. That's fine for fake
data. Don't share the demo password publicly, and never enter real patient information.
