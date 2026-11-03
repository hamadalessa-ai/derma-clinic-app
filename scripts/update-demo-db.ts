/**
 * Updates the live DEMO database: reset + setup in one transaction (see src/db/demo-update.ts).
 * Run by the "Update demo database" GitHub workflow with three repository secrets:
 *   SUPABASE_ADMIN_URL   Supabase "Session pooler" connection string (user postgres.<project-ref>)
 *   APP_DB_PASSWORD      the clinic_app password inside Vercel's DATABASE_URL
 *   DEMO_STAFF_PASSWORD  the password demo staff accounts sign in with
 */
import { runDemoUpdate } from "../src/db/demo-update";

const adminUrl = process.env.SUPABASE_ADMIN_URL ?? "";
const appPassword = process.env.APP_DB_PASSWORD ?? "";
const demoPassword = process.env.DEMO_STAFF_PASSWORD ?? "";

if (!adminUrl || !appPassword || !demoPassword) {
  console.error(
    "Missing secrets. Add SUPABASE_ADMIN_URL, APP_DB_PASSWORD and DEMO_STAFF_PASSWORD " +
      "(GitHub → Settings → Secrets and variables → Actions). See docs/DEPLOY.md.",
  );
  process.exit(1);
}
if (/clinic_app/.test(adminUrl)) {
  console.error(
    "SUPABASE_ADMIN_URL must use the admin user (postgres.<project-ref>), not clinic_app.",
  );
  process.exit(1);
}

runDemoUpdate({ adminUrl, appPassword, demoPassword })
  .then(({ tables }) => {
    console.log(
      `Demo database updated (${tables} tables). Staff phones must turn notifications on again.`,
    );
  })
  .catch((err: unknown) => {
    // Never print the connection string; database errors don't contain the passwords.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Update failed, nothing was changed: ${msg}`);
    process.exit(1);
  });
