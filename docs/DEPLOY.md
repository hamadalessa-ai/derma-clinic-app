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

## Part E — Updating the live demo to Phase 2b (WhatsApp messages, demo mode)

About 15 minutes, all in the browser. Real WhatsApp is **not** needed: everything works in the
**WhatsApp simulator** inside the app. (Real WhatsApp comes later: Part F.)

### E1. Merge and reset the database (5 minutes)

Same as last time (everything is fake demo data):

1. GitHub → the Phase 2b pull request → **Merge pull request → Confirm merge**.
2. Supabase → **SQL Editor** → **+ New query** → paste **`db/reset.sql`** (branch `main`) → **Run** → confirm.
   Expected: _"Reset complete. Now run db/setup.sql."_
3. **+ New query** → paste **`db/setup.sql`** (branch `main`). In **STEP 1** put the **same app database
   password as before** and your demo staff password → **Run**. Expected: _"Setup complete…"_
4. Close both tabs **without saving**.

### E2. Vercel settings (nothing new)

Nothing to add: demo mode uses the settings from Phase 2a. Check that these exist in Vercel →
**Settings → Environment Variables**:

| Name                | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| `MESSAGE_DEMO_MODE` | `on` (messages go to the simulator; nothing is sent)        |
| `CRON_SECRET`       | the random string you added in Phase 2a (you need it in E3) |

If you want links in messages to always use your main address, you can also add `APP_PUBLIC_URL` =
your main link (e.g. `https://derma-clinic-app.vercel.app`, no slash at the end). Optional.

### E3. Hourly schedule on GitHub (5 minutes, no terminal)

Reminders, post-care check-ins, no-show follow-ups and recalls are sent by a schedule that runs **every
hour**. Vercel's free plan only allows one run a day, so GitHub calls the app every hour instead
(free). GitHub needs two secrets:

1. Open your repository on GitHub → **Settings** (top bar) → left menu **Secrets and variables** →
   **Actions** → **New repository secret**.
2. **Name:** `APP_URL` · **Secret:** your main link, e.g. `https://derma-clinic-app.vercel.app`
   (no slash at the end) → **Add secret**.
3. **New repository secret** again → **Name:** `CRON_SECRET` · **Secret:** the **same value** as
   `CRON_SECRET` in Vercel (open it in Vercel → Settings → Environment Variables → ⋯ → Edit to copy it) →
   **Add secret**.
4. Check it works: GitHub → **Actions** (top bar) → **Scheduled WhatsApp messages** → **Run workflow** →
   **Run workflow**. After ~30 seconds the run shows a green ✓. (A red ✗ usually means a secret is
   missing or different from Vercel's.)

From now on it runs every hour by itself. It never sends the same message twice, and if a run is late
or missed, the next one catches up. Nothing is sent between 22:00 and 08:00 (Riyadh). The daily Vercel
job also runs it once a day as a safety net.

> GitHub pauses scheduled workflows after 60 days without any commits to the repository. If that ever
> happens, GitHub → Actions → Scheduled WhatsApp messages → **Enable workflow**.

### E4. Try it (the "done when" check, about 5 minutes)

Use your phone (patient) and your laptop (staff).

1. **Phone:** open `…vercel.app/book` → book with **Dr. Sarah Al-Otaibi** (د. سارة العتيبي) for **tomorrow**,
   e.g. **Facial Treatment** (جلسة تنظيف البشرة). Use a fake mobile like `0598000222`, and **tick**
   _"Send me the booking confirmation and reminders on WhatsApp"_ (no tick = no WhatsApp messages,
   as the rules require).
2. **Laptop:** sign in as `admin@derma.demo` → **WhatsApp simulator** (under **More** on a phone) →
   tap the chat with that number: the **booking confirmation** is there, with date, time, branch,
   doctor, map link and a link to /my.
3. In **Run scheduled messages now**, tick **Ignore quiet hours** (if it's late) and, if the visit is more
   than 24 hours away, **Fast-forward 24 hours** → **Run now**. The **reminder** appears in the chat,
   with the pre-visit instructions and three buttons.
4. Tap **تأكيد (Confirm)** in the simulator. The chat answers "confirmed". Sign in as
   `reception.riyadh1@derma.demo` → **Calendar** → tomorrow: the appointment shows **Confirmed**, and
   inside it the WhatsApp messages and their status.
5. Reception: open the appointment → **Check in** → **Start** → **Complete**.
6. Admin: **Run scheduled messages now** with **Fast-forward 24 hours** → the **post-care check-in**
   ("How is your skin after the facial?") appears in the simulator → tap **لدي استفسار/قلق
   (I have a concern)**.
7. **Dr. Sara's phone** (with notifications on from Phase 2a) gets a push: _"Patient concern"_ with
   initials, service and time. Reception sees the chat in **WhatsApp messages** marked
   **Concern after procedure** and can reply.

More to show:

- **Patient view:** in the simulator, **Patient view (full screen)** → open that page on your phone for a
  WhatsApp-like screen.
- **A new number:** in the simulator, **Simulate a message from a new number** → it appears in **WhatsApp
  messages → New numbers** as "Not a patient yet"; reception can link it to a patient or create one.
- **Running late:** Calendar → a doctor's column → **Running late** → 20 min → their remaining
  patients today get a message.
- **STOP:** type `إيقاف` in a chat → that patient gets no more reminders (shown in the inbox and on the
  patient file). `تفعيل` switches them back on.
- **Wording:** **Settings → WhatsApp message settings**: switch each message type on/off, edit the Arabic
  and English text, pre-visit / post-care texts per service, recall delays, and **Show the service name
  in WhatsApp messages**.

Ready-made demo chats: **D-0001** (reminder confirmed with the button), **D-0011** (concern after laser),
**D-0014** (sent STOP), **D-0019** (Botox recall due — appears after "Run now"), and the new number
**0555123456** asking about prices.

### E5. Update: push log, reschedule and tablet signature fixes (5 minutes)

1. GitHub → the pull request → **Merge pull request → Confirm merge**.
2. Supabase → reset the database exactly as in **E1** (paste `db/reset.sql`, then `db/setup.sql` with the
   **same app database password**). This adds the new **push log** table. Nothing changes in Vercel.
3. Dr. Sara: open the app → **My account** → turn notifications on again if they show as off
   (a reset removes saved devices) → **Send a test notification**.
4. In the WhatsApp simulator, tap **"I have a concern"** on a post-care message. Then, as admin:
   **Settings → WhatsApp → WhatsApp status → Push notification log**. Each line says _sent_, _failed_
   (with the reason), _no device_, _switched off_ or _type muted_.

### E6. Update: notification links per role, concerns on My Day (2 minutes)

1. GitHub → the pull request → **Merge pull request → Confirm merge**. Vercel updates by itself.
2. **No database reset** and nothing new in Vercel or Supabase.
3. Try it: in the simulator tap **"I have a concern"** on a post-care message. Dr. Sara's notification
   now opens the patient's file with a red **Concern** card (the conversation, read-only); the same
   concern is listed at the top of her **My Day** until reception answers it. Reception's
   notification still opens the WhatsApp chat. The push log shows where each notification opens.

### E7. Update: consent renewal rules, doctors handle concerns (10 minutes)

1. GitHub → the pull request → **Merge pull request → Confirm merge**.
2. **Database reset needed** (new tables for consent rules and concern notes, photos on messages):
   Supabase → paste `db/reset.sql` → Run, then `db/setup.sql` with the **same app database
   password** → Run (exactly as in **E1**). Nothing changes in Vercel.
3. Dr. Sara: open the app → **My account** → turn notifications on again (a reset removes devices).
4. Try the consent rules: **Settings → Consent templates → Edit** shows "When is a new signature
   needed?". Open any Botox/peel appointment in the calendar: it says why a signature is or isn't
   needed (e.g. "Signed 3 days ago, valid for this package").
5. Try a concern: Dr. Sara's **My Day** shows D-0011's open concern (demo). Open it → reply, "Ask
   for a photo", note to reception, "Book follow-up", "Mark resolved". In the **WhatsApp simulator**
   the patient sees the reply signed with her name and can attach a photo (📎).
   - "Book follow-up" follows **Settings → Doctors manage their own schedule**: ON = booked
     directly; OFF = reception gets a ready request under **Requests**.
   - Patient photos are visible to doctors and admins only; reception sees "photo received".

---

## Part F — When Meta verification is done (real WhatsApp)

Do this only after Meta has verified the business (it needs the Commercial Registration). Until then
Meta refuses messages with error **131031**, and the status page explains that.

### F1. In Meta (developers.facebook.com → your app "Derma Clinic Demo")

1. **WhatsApp → API Setup:** note the **Phone number ID** and the **WhatsApp Business Account ID**.
2. **Permanent access token:** business.facebook.com → **Settings → Users → System users** → add a system
   user (Admin) → **Add assets** → your app and WhatsApp account (full control) → **Generate new token** →
   choose the app, tick `whatsapp_business_messaging` and `whatsapp_business_management`, expiry
   **Never** → copy it straight into Vercel (F2), not into a chat or a document.
3. **App secret:** your app → **App settings → Basic → App secret → Show**.
4. **Templates:** submit every template in **docs/WHATSAPP_TEMPLATES.md** (WhatsApp Manager → Message
   templates), Arabic and English, with exactly those names. Approval usually takes minutes to a day.

### F2. In Vercel (Settings → Environment Variables)

| Name                           | Value                                                            | Secret? |
| ------------------------------ | ---------------------------------------------------------------- | ------- |
| `WHATSAPP_PROVIDER`            | `meta`                                                           | no      |
| `WHATSAPP_CLINIC`              | `derma` (the clinic this WhatsApp number belongs to)             | no      |
| `WHATSAPP_PHONE_NUMBER_ID`     | from F1                                                          | no      |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | from F1                                                          | no      |
| `WHATSAPP_ACCESS_TOKEN`        | the permanent token from F1                                      | **yes** |
| `WHATSAPP_APP_SECRET`          | the app secret from F1                                           | **yes** |
| `WHATSAPP_VERIFY_TOKEN`        | a new random string from <https://generate-secret.vercel.app/32> | **yes** |

For the three secrets, tick **Sensitive** when adding them. Then **change** `MESSAGE_DEMO_MODE` to `off`
(or delete it): while it is `on`, a demo clinic keeps using the simulator. **Redeploy**
(Deployments → latest → ⋯ → Redeploy).

### F3. Connect the webhook (Meta → your app → WhatsApp → Configuration)

1. **Callback URL:** `https://<your main link>/api/whatsapp/webhook`
2. **Verify token:** the same value as `WHATSAPP_VERIFY_TOKEN` → **Verify and save**.
3. **Webhook fields → messages → Subscribe**.
4. In the app: **Settings → WhatsApp message settings → WhatsApp status and errors**: mode **Live**,
   webhook **Verified**. Use **Send test message** with your own number (Meta's `hello_world` test).

Failures and their meaning (e.g. 131047 "more than 24 hours", 190 "token expired") are listed on that
status page in plain words.

### Using a WhatsApp provider instead (Unifonic, Taqnyat, Twilio, 360dialog…)

The app is built so a provider is **one new file** (`src/lib/whatsapp/<provider>.ts`) plus one line in
`src/lib/whatsapp/transport.ts`, then `WHATSAPP_PROVIDER=<provider>` and that provider's keys in Vercel.
Ask for it when you've chosen one.

---

## Part G — Automatic database updates (no more SQL Editor)

From now on, a merge that changes the database updates the live demo **by itself**: the GitHub
workflow **"Update demo database"** runs `db/reset.sql` and `db/setup.sql` as **one** step. It either
fully works or changes nothing, so a failed run never leaves the demo empty. Demo only: it deletes all
app data and rebuilds the fake clinics, like the manual reset did.

### G1. One-time setup (10 minutes, no terminal)

1. **Supabase → Project Settings → Database → Reset database password.** Generate a new one and save it
   in your password manager as "Supabase admin (postgres)". This is the admin password, not the app
   one; it doesn't affect Vercel or the app.
2. **Supabase → Connect → Session pooler** (port **5432**, not 6543). Copy the string. It looks like
   `postgresql://postgres.wmrgcidygdkcmhurfxtv:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`.
   In your notes, replace `[YOUR-PASSWORD]` (brackets too) with the admin password from step 1.
   Keep the user as `postgres.…` here (the admin), **not** `clinic_app.…`.
3. **GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret**, three times:

| Name                  | Secret                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| `SUPABASE_ADMIN_URL`  | the Session pooler string from step 2, with the admin password filled in |
| `APP_DB_PASSWORD`     | the **same** clinic_app password that is inside Vercel's `DATABASE_URL`  |
| `DEMO_STAFF_PASSWORD` | the password demo staff sign in with                                     |

4. Test it: **Actions → Update demo database → Run workflow**. After about a minute you should see a
   green ✓ and the line _"Demo database updated (… tables)"_. Then open the app and sign in.

### G2. After each automatic update

- Staff phones must turn notifications on again (**My account → Turn on for this device**): the reset
  removes saved phones.
- If a run fails (red ✗), nothing was changed. The log says why; the most common cause is a secret
  with a typo. Fix the secret and press **Run workflow** again.

### G3. Tests on GitHub

The **"Tests"** workflow runs every automatic check (lint, formatting, types, all database tests) on
every pull request and every change to `main`. A pull request is only merged when it shows a green ✓.

## Part H — AI receptionist (WhatsApp)

The AI receptionist answers patients' typed WhatsApp messages (and the simulator) in Arabic or English:
questions about services, prices (only if "show prices" is on), branches and hours, and booking,
cancelling or moving visits with the same rules as `/book`. It **always asks the patient to reply
"yes" before booking, cancelling or moving**, never gives medical advice, and passes medical questions,
complaints and anything unsure to the inbox (a medical worry about a recent visit also reaches the
doctor as a concern). It is **on for Derma Clinics** in the demo data; it only answers once a key is set.

### H1. Add the key (5 minutes, no terminal)

1. **console.anthropic.com → API keys → Create key.** Name it "Derma demo". Copy it once (it starts with
   `sk-ant-`) and save it in your password manager. Never paste it into a chat.
2. **Vercel → your project → Settings → Environment Variables → Add:**
   `ANTHROPIC_API_KEY` = the key (choose **Secret**).
3. **Deployments → the latest → ⋯ → Redeploy.**
4. **Admin → Settings → WhatsApp messages:** the "AI receptionist" card should say _"AI key is set ✓"_.
   Here you can switch it off and set the daily limit (default 200 replies a day).

Optional: `ANTHROPIC_MODEL` chooses another Claude model (default: the fast, low-cost Haiku model).

### H2. Try it in the simulator

As admin or reception: **More → WhatsApp simulator → Simulate a message from a new number**, and type,
for example, _"السلام عليكم، أبغى أحجز استشارة يوم الأحد"_. The AI asks what it needs, offers times,
asks you to reply **نعم**, and books. The booking appears on the calendar with the WhatsApp source.
Try _"عندي احمرار بعد الليزر"_: it hands the chat to the team instead of answering.

### H3. How staff stay in control

- In the **inbox**, every chat shows _"AI answering"_ or _"Staff took over"_. **Take over (pause AI)** stops
  the AI in that chat; **Let the AI answer** turns it back on. Replying yourself also pauses it.
- When the AI hands a medical question over, the chat stays under **Needs reply** until someone answers or
  presses **Mark handled**. Meanwhile the AI still helps the patient with other things (booking, questions),
  never with that medical topic.
- Every AI message is labelled "AI receptionist", and every booking, cancellation, move and hand-off is
  in the audit log.
- If the AI can't answer (no credit, the service is down, the daily limit), messages go to the inbox
  exactly as before. Nothing is lost.

> **Before real patients:** messages are processed by Anthropic outside Saudi Arabia. Check PDPL and
> patient consent with a lawyer first. Only fake demo data until then.

## Part I — AI scribe (doctors)

Doctors speak their notes during the examination instead of typing; the AI turns them into an
**English note draft** in the visit note. The doctor reviews, edits and **signs** — nothing is signed
for them. It writes down only what the doctor said: no diagnoses, codes, doses or suggestions of its own.
It uses the same `ANTHROPIC_API_KEY` as the AI receptionist (Part H). On for Derma in the demo data;
**Admin → Settings → "AI scribe for doctors"** switches it on/off.

### Try it

1. Sign in as **dr.sara@derma.demo** (Chrome on a laptop or Android, or Safari on iPhone/iPad).
2. Open a patient → **Notes** → **New note** (or **Start** a visit from My Day, then its note).
3. In the **AI scribe** box: choose **Arabic (Saudi)** or **English** → **Start dictation** → allow the
   microphone → speak, e.g. _"المريضة جلسة ليزر رابعة للإبط، الإعدادات ٢٢ جول، ما في احمرار، الجلسة
   الجاية بعد ستة أسابيع"_ → **Stop**. Correct any wrong words in the box if needed.
4. **Write the note** → an English draft appears in the note, marked _"AI draft — review before signing"_.
5. Edit if needed → **Sign note**.

Notes: the browser does the speech recognition (Google in Chrome, Apple in Safari); the audio is never
stored, only the draft. Firefox can't dictate — type or paste instead. Later, a medical speech service
(e.g. Speechmatics' Arabic–English medical model) can replace browser dictation for better accuracy.

> **Before real patients:** speech and text are processed outside Saudi Arabia (Google/Apple, Anthropic).
> Check PDPL, patient information and SFDA with a lawyer first. Fake demo data only until then.

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
