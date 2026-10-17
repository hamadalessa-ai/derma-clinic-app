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
If a phase changes the database, I'll give you a numbered `db/upgrades/...sql` file to run in the
SQL Editor first, the same way as Part A.

### Changing a secret

Vercel → your project → **Settings → Environment Variables** → edit → then **Deployments** →
the latest one → **⋯ → Redeploy**. Changes only apply after a redeploy.

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
